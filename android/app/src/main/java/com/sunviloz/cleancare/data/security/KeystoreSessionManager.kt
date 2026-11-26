package com.sunviloz.cleancare.data.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.sunviloz.cleancare.BuildConfig
import com.sunviloz.cleancare.data.model.AuthUser
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID

/**
 * Android Keystore-backed session storage.
 *
 * Security guarantees:
 * - Uses hardware-backed Android Keystore AES-256-GCM MasterKey + EncryptedSharedPreferences.
 * - Stores ONLY the revocable server-issued session token, public user profile, device ID,
 *   Apps Script endpoint URL, and device unlock preference.
 * - NEVER stores user passwords, password hashes, phone PINs, or biometric data.
 */
class KeystoreSessionManager(context: Context) {

    private val json = Json { ignoreUnknownKeys = true }

    private val masterKey: MasterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        PREFS_FILE,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun getOrCreateDeviceId(): String {
        val existing = prefs.getString(KEY_DEVICE_ID, null)
        if (!existing.isNullOrBlank()) return existing
        val created = "AND-${UUID.randomUUID().toString().replace("-", "").take(12).uppercase()}"
        prefs.edit().putString(KEY_DEVICE_ID, created).apply()
        return created
    }

    fun getAppsScriptUrl(): String {
        val saved = prefs.getString(KEY_APPS_SCRIPT_URL, "")?.trim().orEmpty()
        return saved.ifBlank { BuildConfig.DEFAULT_APPS_SCRIPT_URL.trim() }
    }

    fun setAppsScriptUrl(url: String) {
        prefs.edit().putString(KEY_APPS_SCRIPT_URL, url.trim()).apply()
    }

    fun saveSession(token: String, user: AuthUser) {
        prefs.edit()
            .putString(KEY_SESSION_TOKEN, token)
            .putString(KEY_USER_JSON, json.encodeToString(user))
            .apply()
    }

    fun getSessionToken(): String = prefs.getString(KEY_SESSION_TOKEN, "").orEmpty()

    fun getSavedUser(): AuthUser? {
        val raw = prefs.getString(KEY_USER_JSON, null) ?: return null
        return runCatching { json.decodeFromString<AuthUser>(raw) }.getOrNull()
    }

    fun hasActiveSession(): Boolean = getSessionToken().isNotBlank() && getSavedUser() != null

    fun isDeviceUnlockEnabled(): Boolean = prefs.getBoolean(KEY_BIOMETRIC_ENABLED, true)

    fun setDeviceUnlockEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_BIOMETRIC_ENABLED, enabled).apply()
    }

    fun clearSession() {
        prefs.edit()
            .remove(KEY_SESSION_TOKEN)
            .remove(KEY_USER_JSON)
            .apply()
    }

    companion object {
        private const val PREFS_FILE = "sunviloz_keystore_session"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_APPS_SCRIPT_URL = "apps_script_url"
        private const val KEY_SESSION_TOKEN = "session_token"
        private const val KEY_USER_JSON = "user_json"
        private const val KEY_BIOMETRIC_ENABLED = "biometric_unlock_enabled"
    }
}
