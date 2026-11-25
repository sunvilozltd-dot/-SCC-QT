package com.sunviloz.cleancare

import android.app.Application
import com.sunviloz.cleancare.data.backup.SecondaryDriveBackupManager
import com.sunviloz.cleancare.data.network.AppsScriptApiClient
import com.sunviloz.cleancare.data.security.KeystoreSessionManager
import com.sunviloz.cleancare.data.sync.PendingSyncDatabase
import com.sunviloz.cleancare.data.sync.PendingSyncRepository

class SunvilozApplication : Application() {

    lateinit var sessionManager: KeystoreSessionManager
        private set
    lateinit var apiClient: AppsScriptApiClient
        private set
    lateinit var syncRepository: PendingSyncRepository
        private set
    lateinit var backupManager: SecondaryDriveBackupManager
        private set

    override fun onCreate() {
        super.onCreate()
        sessionManager = KeystoreSessionManager(this)
        apiClient = AppsScriptApiClient(sessionManager)
        val db = PendingSyncDatabase.getInstance(this)
        syncRepository = PendingSyncRepository(this, db.dao(), apiClient)
        backupManager = SecondaryDriveBackupManager(this, apiClient)
    }
}
