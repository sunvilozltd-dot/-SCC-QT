package com.sunviloz.cleancare.data.network

import com.sunviloz.cleancare.data.security.KeystoreSessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URI
import java.util.UUID
import java.util.concurrent.TimeUnit

sealed class ApiException(message: String, val code: String) : Exception(message)
class BackendUnconfiguredException(message: String) : ApiException(message, "BACKEND_UNCONFIGURED")
class BackendUnreachableException(message: String) : ApiException(message, "BACKEND_UNREACHABLE")
class BackendSetupRequiredException(message: String) : ApiException(message, "BACKEND_SETUP_REQUIRED")
class InvalidCredentialsException(message: String) : ApiException(message, "AUTH_FAILED")
class SessionRevokedException(message: String) : ApiException(message, "SESSION_REVOKED")
class StatusLockedException(message: String) : ApiException(message, "STATUS_LOCKED")
class ServerValidationException(message: String, code: String = "SERVER_ERROR") : ApiException(message, code)

/**
 * Native HTTPS client for the SUNVILOZ Clean Care Google Apps Script Web App API.
 *
 * - Strictly enforces HTTPS on script.google.com / script.googleusercontent.com.
 * - Handles Apps Script 302 redirects cleanly via OkHttp followRedirects.
 * - Sends stable request_id for idempotent write deduplication.
 * - Distinguishes BackendUnconfigured / BackendUnreachable / BackendSetupRequired
 *   from InvalidCredentialsException ("Invalid username or password.").
 */
class AppsScriptApiClient(private val sessionManager: KeystoreSessionManager) {

    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        isLenient = true
        coerceInputValues = true
    }

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .writeTimeout(35, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    fun isValidAppsScriptUrl(url: String): Boolean {
        val clean = url.trim()
        if (clean.isBlank()) return false
        return runCatching {
            val uri = URI(clean)
            uri.scheme == "https" &&
                (uri.host == "script.google.com" || uri.host == "script.googleusercontent.com")
        }.getOrDefault(false)
    }

    suspend fun postAction(
        action: String,
        payload: JsonObject = buildJsonObject {},
        requestId: String = "req-${UUID.randomUUID()}",
        includeAuthToken: Boolean = true
    ): JsonElement = withContext(Dispatchers.IO) {
        val url = sessionManager.getAppsScriptUrl()
        if (url.isBlank()) {
            throw BackendUnconfiguredException(
                "Apps Script backend URL is not configured. Tap \"Configure Backend URL\" and paste your deployed Web App URL."
            )
        }
        if (!isValidAppsScriptUrl(url)) {
            throw BackendUnconfiguredException(
                "Invalid Apps Script URL. It must start with https://script.google.com/macros/s/..."
            )
        }

        val bodyObj = buildJsonObject {
            put("action", action)
            put("request_id", requestId)
            if (includeAuthToken) {
                put("token", sessionManager.getSessionToken())
            }
            put("payload", payload)
        }

        val request = Request.Builder()
            .url(url)
            .post(bodyObj.toString().toRequestBody(JSON_MEDIA_TYPE))
            .header("Accept", "application/json")
            .build()

        val rawText = try {
            client.newCall(request).execute().use { resp ->
                resp.body?.string().orEmpty()
            }
        } catch (e: IOException) {
            throw BackendUnreachableException(
                "Unable to reach the Apps Script backend. Check your internet connection and retry."
            )
        }

        val root = runCatching { json.parseToJsonElement(rawText).jsonObject }.getOrNull()
            ?: throw BackendUnreachableException(
                "Apps Script returned a non-JSON response. Verify Web App deployment access is set to \"Anyone\"."
            )

        val ok = root["ok"]?.jsonPrimitive?.content == "true"
        if (!ok) {
            val code = root["code"]?.jsonPrimitive?.content.orEmpty()
            val errorMsg = root["error"]?.jsonPrimitive?.content.orEmpty()
                .ifBlank { "Request failed." }
            when (code) {
                "AUTH_FAILED" -> throw InvalidCredentialsException(errorMsg)
                "AUTH_REQUIRED", "SESSION_REVOKED" -> {
                    sessionManager.clearSession()
                    throw SessionRevokedException(errorMsg)
                }
                "BACKEND_SETUP_REQUIRED" -> throw BackendSetupRequiredException(errorMsg)
                "STATUS_LOCKED" -> throw StatusLockedException(errorMsg)
                else -> throw ServerValidationException(errorMsg, code)
            }
        }

        root["data"] ?: buildJsonObject {}
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
