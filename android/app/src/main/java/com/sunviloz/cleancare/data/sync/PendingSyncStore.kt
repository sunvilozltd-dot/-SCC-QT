package com.sunviloz.cleancare.data.sync

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.sunviloz.cleancare.SunvilozApplication
import com.sunviloz.cleancare.data.model.SyncBadgeState
import com.sunviloz.cleancare.data.network.AppsScriptApiClient
import com.sunviloz.cleancare.data.network.BackendUnreachableException
import com.sunviloz.cleancare.data.network.SessionRevokedException
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * Durable offline pending-mutation queue (Room).
 *
 * IMPORTANT: This is NOT the primary business database — Google Sheets is the sole
 * authoritative store. This table holds ONLY unsynced offline edits with their stable
 * request_id so retries never duplicate orders, payments, or completions.
 */
@Entity(tableName = "pending_mutations")
data class PendingMutationEntity(
    @PrimaryKey val requestId: String,
    val action: String,
    val payloadJson: String,
    val label: String,
    val createdAtMs: Long,
    val lastError: String = "",
    val retryCount: Int = 0
)

@Dao
interface PendingMutationDao {
    @Query("SELECT * FROM pending_mutations ORDER BY createdAtMs ASC")
    fun observeAll(): Flow<List<PendingMutationEntity>>

    @Query("SELECT * FROM pending_mutations ORDER BY createdAtMs ASC")
    suspend fun getAll(): List<PendingMutationEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(item: PendingMutationEntity)

    @Query("DELETE FROM pending_mutations WHERE requestId = :requestId")
    suspend fun deleteById(requestId: String)

    @Query("UPDATE pending_mutations SET lastError = :err, retryCount = retryCount + 1 WHERE requestId = :requestId")
    suspend fun recordFailure(requestId: String, err: String)
}

@Database(entities = [PendingMutationEntity::class], version = 1, exportSchema = false)
abstract class PendingSyncDatabase : RoomDatabase() {
    abstract fun dao(): PendingMutationDao

    companion object {
        @Volatile private var instance: PendingSyncDatabase? = null

        fun getInstance(context: Context): PendingSyncDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    PendingSyncDatabase::class.java,
                    "sunviloz_pending_sync.db"
                ).build().also { instance = it }
            }
    }
}

data class SyncFlushResult(
    val syncedCount: Int,
    val remainingCount: Int,
    val lastError: String
) {
    val badgeState: SyncBadgeState
        get() = when {
            remainingCount == 0 && lastError.isBlank() -> SyncBadgeState.SAVED
            lastError.isNotBlank() -> SyncBadgeState.SYNC_FAILED
            else -> SyncBadgeState.PENDING_SYNC
        }
}

class PendingSyncRepository(
    private val context: Context,
    private val dao: PendingMutationDao,
    private val api: AppsScriptApiClient
) {
    private val json = Json { ignoreUnknownKeys = true }

    fun observeQueue(): Flow<List<PendingMutationEntity>> = dao.observeAll()

    suspend fun enqueueOffline(requestId: String, action: String, payload: JsonObject, label: String, error: String) {
        dao.upsert(
            PendingMutationEntity(
                requestId = requestId,
                action = action,
                payloadJson = payload.toString(),
                label = label,
                createdAtMs = System.currentTimeMillis(),
                lastError = error
            )
        )
        scheduleBackgroundRetry()
    }

    fun scheduleBackgroundRetry() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val req = OneTimeWorkRequestBuilder<PendingSyncWorker>()
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            "sunviloz_pending_sync_flush",
            ExistingWorkPolicy.REPLACE,
            req
        )
    }

    suspend fun flushQueue(): SyncFlushResult {
        val items = dao.getAll()
        if (items.isEmpty()) return SyncFlushResult(0, 0, "")

        var synced = 0
        var lastErr = ""
        for (item in items) {
            try {
                val payloadObj = json.parseToJsonElement(item.payloadJson).jsonObject
                api.postAction(
                    action = item.action,
                    payload = payloadObj,
                    requestId = item.requestId
                )
                // Only remove after Apps Script confirms the write!
                dao.deleteById(item.requestId)
                synced++
            } catch (e: BackendUnreachableException) {
                lastErr = e.message.orEmpty()
                dao.recordFailure(item.requestId, lastErr)
                break
            } catch (e: SessionRevokedException) {
                lastErr = e.message.orEmpty()
                dao.recordFailure(item.requestId, lastErr)
                break
            } catch (e: Exception) {
                lastErr = e.message.orEmpty()
                dao.recordFailure(item.requestId, lastErr)
            }
        }
        val remaining = dao.getAll().size
        return SyncFlushResult(synced, remaining, lastErr)
    }
}

class PendingSyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as? SunvilozApplication ?: return Result.failure()
        val res = app.syncRepository.flushQueue()
        return if (res.remainingCount == 0) Result.success() else Result.retry()
    }
}
