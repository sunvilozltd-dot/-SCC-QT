package com.sunviloz.cleancare.data.backup

import android.content.Context
import android.net.Uri
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import com.sunviloz.cleancare.data.model.BackupValidationSummary
import com.sunviloz.cleancare.data.network.AppsScriptApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.MessageDigest
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

data class SecondaryDriveVersionItem(
    val fileId: String,
    val fileName: String,
    val createdTime: String,
    val sizeBytes: Long
)

data class SecondaryBackupOutcome(
    val fileId: String,
    val fileName: String,
    val secondaryEmail: String,
    val sizeBytes: Long,
    val checksumSha256: String
)

/**
 * Admin-only Secondary Google Drive Backup & Restore manager.
 *
 * Security & durability rules enforced:
 * 1. Authorizes a SECOND Google account directly from Android using Google AuthorizationClient
 *    with drive.file + userinfo.email scopes.
 * 2. Fetches the verified Google account email and REJECTS it if it matches the primary owner account.
 * 3. Uploads an actual private dated backup file owned directly by the second Google account
 *    (never a shortcut/link to the primary Drive).
 * 4. Verifies SHA-256 integrity by reading back the uploaded file before marking backup as Verified.
 * 5. Supports restore from either a dated version in Secondary Drive OR a downloaded local JSON file,
 *    with validation & preview before confirmation, preserving existing data on any failure.
 */
class SecondaryDriveBackupManager(
    private val context: Context,
    private val api: AppsScriptApiClient
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(45, TimeUnit.SECONDS)
        .build()

    fun buildGoogleAuthorizationRequest(): AuthorizationRequest =
        AuthorizationRequest.builder()
            .setRequestedScopes(
                listOf(
                    Scope("https://www.googleapis.com/auth/drive.file"),
                    Scope("https://www.googleapis.com/auth/userinfo.email")
                )
            )
            .build()

    fun authorizationClient() = Identity.getAuthorizationClient(context)

    suspend fun fetchVerifiedGoogleEmail(accessToken: String): String = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("https://www.googleapis.com/oauth2/v3/userinfo")
            .header("Authorization", "Bearer $accessToken")
            .get()
            .build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw IllegalStateException("Could not verify Google account email (HTTP ${resp.code}).")
            }
            val body = json.parseToJsonElement(resp.body?.string().orEmpty()).jsonObject
            body["email"]?.jsonPrimitive?.content?.trim()?.lowercase()
                ?: throw IllegalStateException("Verified email missing from Google account response.")
        }
    }

    fun assertNotPrimaryAccount(secondaryEmail: String, primaryOwnerEmail: String) {
        val sec = secondaryEmail.trim().lowercase()
        val pri = primaryOwnerEmail.trim().lowercase()
        if (sec.isBlank()) throw IllegalArgumentException("Secondary Google account email is required.")
        if (pri.isNotBlank() && sec == pri) {
            throw IllegalArgumentException(
                "Rejected: $sec is the Primary Google account. Choose a different, independent Google account for backups."
            )
        }
    }

    /**
     * Runs "Back Up Now":
     * 1. Exports sanitized backup JSON from Apps Script (excluding passwords/hashes/tokens/secrets).
     * 2. Creates/finds private folder in the SECOND Google account's Drive.
     * 3. Uploads a brand-new dated JSON file owned directly by the second account.
     * 4. Reads back the uploaded file and confirms SHA-256 checksum matches BEFORE recording success.
     */
    suspend fun runManualBackupNow(
        secondaryAccessToken: String,
        primaryOwnerEmail: String,
        folderName: String = "SUNVILOZ Clean Care Backups"
    ): SecondaryBackupOutcome = withContext(Dispatchers.IO) {
        val secondaryEmail = fetchVerifiedGoogleEmail(secondaryAccessToken)
        assertNotPrimaryAccount(secondaryEmail, primaryOwnerEmail)

        val backupElement = api.postAction("backup.export_payload")
        val backupObj = backupElement.jsonObject
        val expectedChecksum = backupObj["checksum_sha256"]?.jsonPrimitive?.content.orEmpty()
        val contentStr = backupObj.toString()

        val stamp = ZonedDateTime.now(ZoneId.of("Asia/Dhaka"))
            .format(DateTimeFormatter.ofPattern("yyyy-MM-dd_HHmmss"))
        val fileName = "sunviloz_backup_$stamp.json"

        try {
            val folderId = findOrCreateDriveFolder(secondaryAccessToken, folderName)
            val uploadedId = uploadMultipartJsonFile(secondaryAccessToken, folderId, fileName, contentStr)

            // Read-back verification before marking Verified
            val readBackText = downloadDriveFileContent(secondaryAccessToken, uploadedId)
            val readBackObj = json.parseToJsonElement(readBackText).jsonObject
            val readBackPayload = readBackObj["payload"]?.toString().orEmpty()
            val actualChecksum = sha256Hex(readBackPayload)
            if (expectedChecksum.isNotBlank() && actualChecksum != expectedChecksum) {
                throw IllegalStateException("Backup verification failed (SHA-256 mismatch). Previous verified backup preserved.")
            }

            val sizeBytes = contentStr.toByteArray(Charsets.UTF_8).size.toLong()
            api.postAction(
                action = "backup.record_status",
                payload = buildJsonObject {
                    put("source", "android_secondary_drive")
                    put("status", "verified")
                    put("file_name", fileName)
                    put("drive_file_id", uploadedId)
                    put("drive_account_email", secondaryEmail)
                    put("folder_name", folderName)
                    put("size_bytes", sizeBytes)
                    put("checksum_sha256", actualChecksum)
                }
            )
            SecondaryBackupOutcome(uploadedId, fileName, secondaryEmail, sizeBytes, actualChecksum)
        } catch (e: Exception) {
            runCatching {
                api.postAction(
                    action = "backup.record_status",
                    payload = buildJsonObject {
                        put("source", "android_secondary_drive")
                        put("status", "failed")
                        put("file_name", fileName)
                        put("drive_account_email", secondaryEmail)
                        put("folder_name", folderName)
                        put("error_message", e.message ?: "Backup failed")
                    }
                )
            }
            throw e
        }
    }

    suspend fun listDatedBackupVersions(
        secondaryAccessToken: String,
        folderName: String = "SUNVILOZ Clean Care Backups"
    ): List<SecondaryDriveVersionItem> = withContext(Dispatchers.IO) {
        val folderId = findDriveFolder(secondaryAccessToken, folderName) ?: return@withContext emptyList()
        val q = "'$folderId' in parents and trashed = false and mimeType = 'application/json'"
        val url = "https://www.googleapis.com/drive/v3/files?q=${java.net.URLEncoder.encode(q, "UTF-8")}" +
            "&orderBy=createdTime%20desc&fields=files(id,name,createdTime,size)"
        val req = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $secondaryAccessToken")
            .get()
            .build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw IllegalStateException("Failed to list secondary Drive backups (HTTP ${resp.code}).")
            val root = json.parseToJsonElement(resp.body?.string().orEmpty()).jsonObject
            val arr = root["files"]?.jsonArray ?: return@withContext emptyList()
            arr.map { el ->
                val obj = el.jsonObject
                SecondaryDriveVersionItem(
                    fileId = obj["id"]?.jsonPrimitive?.content.orEmpty(),
                    fileName = obj["name"]?.jsonPrimitive?.content.orEmpty(),
                    createdTime = obj["createdTime"]?.jsonPrimitive?.content.orEmpty(),
                    sizeBytes = obj["size"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L
                )
            }
        }
    }

    suspend fun previewBackupFromSecondaryDrive(
        secondaryAccessToken: String,
        fileId: String
    ): Pair<JsonObject, BackupValidationSummary> = withContext(Dispatchers.IO) {
        val text = downloadDriveFileContent(secondaryAccessToken, fileId)
        previewBackupJsonText(text)
    }

    suspend fun previewBackupFromLocalUri(uri: Uri): Pair<JsonObject, BackupValidationSummary> = withContext(Dispatchers.IO) {
        val text = context.contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
            ?: throw IllegalStateException("Unable to read selected backup file.")
        previewBackupJsonText(text)
    }

    suspend fun previewBackupJsonText(jsonText: String): Pair<JsonObject, BackupValidationSummary> {
        val backupObj = json.parseToJsonElement(jsonText).jsonObject
        val validatedEl = api.postAction(
            action = "backup.validate",
            payload = buildJsonObject { put("backup", backupObj) }
        )
        val summary = json.decodeFromJsonElement<BackupValidationSummary>(validatedEl)
        return backupObj to summary
    }

    suspend fun confirmRestore(backupObj: JsonObject, requestId: String): String {
        val res = api.postAction(
            action = "backup.restore",
            payload = buildJsonObject { put("backup", backupObj) },
            requestId = requestId
        ).jsonObject
        return res["message"]?.jsonPrimitive?.content ?: "Backup restored successfully."
    }

    private fun findDriveFolder(accessToken: String, folderName: String): String? {
        val safeName = folderName.replace("'", "\\'")
        val q = "name = '$safeName' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        val url = "https://www.googleapis.com/drive/v3/files?q=${java.net.URLEncoder.encode(q, "UTF-8")}&fields=files(id)"
        val req = Request.Builder().url(url).header("Authorization", "Bearer $accessToken").get().build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return null
            val files = json.parseToJsonElement(resp.body?.string().orEmpty()).jsonObject["files"]?.jsonArray
            return files?.firstOrNull()?.jsonObject?.get("id")?.jsonPrimitive?.content
        }
    }

    private fun findOrCreateDriveFolder(accessToken: String, folderName: String): String {
        findDriveFolder(accessToken, folderName)?.let { return it }
        val meta = buildJsonObject {
            put("name", folderName)
            put("mimeType", "application/vnd.google-apps.folder")
        }.toString()
        val req = Request.Builder()
            .url("https://www.googleapis.com/drive/v3/files?fields=id")
            .header("Authorization", "Bearer $accessToken")
            .post(meta.toRequestBody("application/json; charset=utf-8".toMediaType()))
            .build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw IllegalStateException("Could not create private backup folder (HTTP ${resp.code}).")
            return json.parseToJsonElement(resp.body?.string().orEmpty())
                .jsonObject["id"]?.jsonPrimitive?.content
                ?: throw IllegalStateException("Drive did not return folder ID.")
        }
    }

    private fun uploadMultipartJsonFile(accessToken: String, folderId: String, fileName: String, content: String): String {
        val boundary = "sunviloz_bkp_${System.currentTimeMillis()}"
        val metadata = buildJsonObject {
            put("name", fileName)
            put("parents", kotlinx.serialization.json.buildJsonArray { add(kotlinx.serialization.json.JsonPrimitive(folderId)) })
            put("mimeType", "application/json")
        }.toString()
        val body = buildString {
            append("--$boundary\r\n")
            append("Content-Type: application/json; charset=UTF-8\r\n\r\n")
            append(metadata)
            append("\r\n--$boundary\r\n")
            append("Content-Type: application/json; charset=UTF-8\r\n\r\n")
            append(content)
            append("\r\n--$boundary--")
        }
        val req = Request.Builder()
            .url("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id")
            .header("Authorization", "Bearer $accessToken")
            .post(body.toRequestBody("multipart/related; boundary=$boundary".toMediaType()))
            .build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw IllegalStateException("Failed to upload backup to Secondary Drive (HTTP ${resp.code}).")
            return json.parseToJsonElement(resp.body?.string().orEmpty())
                .jsonObject["id"]?.jsonPrimitive?.content
                ?: throw IllegalStateException("Drive did not return uploaded file ID.")
        }
    }

    private fun downloadDriveFileContent(accessToken: String, fileId: String): String {
        val req = Request.Builder()
            .url("https://www.googleapis.com/drive/v3/files/$fileId?alt=media")
            .header("Authorization", "Bearer $accessToken")
            .get()
            .build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw IllegalStateException("Failed to read backup file from Secondary Drive (HTTP ${resp.code}).")
            return resp.body?.string().orEmpty()
        }
    }

    private fun sha256Hex(text: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
