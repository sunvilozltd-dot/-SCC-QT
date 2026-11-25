package com.sunviloz.cleancare.ui

import android.app.Application
import android.net.Uri
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.sunviloz.cleancare.SunvilozApplication
import com.sunviloz.cleancare.data.backup.SecondaryDriveVersionItem
import com.sunviloz.cleancare.data.model.AdminBootstrapPayload
import com.sunviloz.cleancare.data.model.AuthActionMessageResponse
import com.sunviloz.cleancare.data.model.AuthStatusResponse
import com.sunviloz.cleancare.data.model.AuthUser
import com.sunviloz.cleancare.data.model.BackupValidationSummary
import com.sunviloz.cleancare.data.model.LoginResponse
import com.sunviloz.cleancare.data.model.MonthlyReportPayload
import com.sunviloz.cleancare.data.model.OtherExpenseItem
import com.sunviloz.cleancare.data.model.QuotationItem
import com.sunviloz.cleancare.data.model.SunvilozConstants
import com.sunviloz.cleancare.data.model.SupervisorJobsPayload
import com.sunviloz.cleancare.data.model.SyncBadgeState
import com.sunviloz.cleancare.data.network.BackendSetupRequiredException
import com.sunviloz.cleancare.data.network.BackendUnconfiguredException
import com.sunviloz.cleancare.data.network.BackendUnreachableException
import com.sunviloz.cleancare.data.network.InvalidCredentialsException
import com.sunviloz.cleancare.data.network.SessionRevokedException
import com.sunviloz.cleancare.data.sync.PendingMutationEntity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.put
import java.util.UUID

sealed class AuthGateState {
    data object Loading : AuthGateState()
    data class BiometricLock(val user: AuthUser) : AuthGateState()
    data object Unauthenticated : AuthGateState()
    data class Authenticated(val user: AuthUser) : AuthGateState()
}

data class AppUiState(
    val authState: AuthGateState = AuthGateState.Loading,
    val appsScriptUrl: String = "",
    val backendStatus: AuthStatusResponse? = null,
    val backendWarning: String = "",
    val loginError: String = "",
    val busy: Boolean = false,
    val toastMessage: String = "",
    val syncBadge: SyncBadgeState = SyncBadgeState.SAVED,
    val lastSyncError: String = "",
    val bootstrap: AdminBootstrapPayload = AdminBootstrapPayload(),
    val supervisorJobs: SupervisorJobsPayload = SupervisorJobsPayload(),
    val monthlyReport: MonthlyReportPayload = MonthlyReportPayload(),
    val deviceUnlockEnabled: Boolean = true,
    // Secondary Google Drive Backup state (in-memory OAuth token only; never persisted to plain disk)
    val secondaryAccessToken: String = "",
    val secondaryVerifiedEmail: String = "",
    val secondaryVersions: List<SecondaryDriveVersionItem> = emptyList(),
    val pendingRestoreJson: JsonObject? = null,
    val pendingRestoreSummary: BackupValidationSummary? = null,
    val backupBusy: Boolean = false
)

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as SunvilozApplication
    val sessionManager = app.sessionManager
    val api = app.apiClient
    val syncRepo = app.syncRepository
    val backupManager = app.backupManager

    private val _ui = MutableStateFlow(
        AppUiState(
            appsScriptUrl = sessionManager.getAppsScriptUrl(),
            deviceUnlockEnabled = sessionManager.isDeviceUnlockEnabled()
        )
    )
    val ui: StateFlow<AppUiState> = _ui.asStateFlow()

    val pendingQueue: StateFlow<List<PendingMutationEntity>> = syncRepo.observeQueue()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        initializeApp()
        viewModelScope.launch {
            pendingQueue.collect { items ->
                _ui.update { state ->
                    val badge = when {
                        items.any { it.lastError.isNotBlank() } -> SyncBadgeState.SYNC_FAILED
                        items.isNotEmpty() -> SyncBadgeState.PENDING_SYNC
                        else -> SyncBadgeState.SAVED
                    }
                    state.copy(
                        syncBadge = badge,
                        lastSyncError = items.firstOrNull { it.lastError.isNotBlank() }?.lastError.orEmpty()
                    )
                }
            }
        }
    }

    fun clearToast() {
        _ui.update { it.copy(toastMessage = "") }
    }

    fun initializeApp() {
        viewModelScope.launch {
            val savedUser = sessionManager.getSavedUser()
            val hasSession = sessionManager.hasActiveSession()
            if (hasSession && savedUser != null) {
                if (sessionManager.isDeviceUnlockEnabled()) {
                    _ui.update { it.copy(authState = AuthGateState.BiometricLock(savedUser)) }
                } else {
                    resumeAfterUnlock(savedUser)
                }
            } else {
                _ui.update { it.copy(authState = AuthGateState.Unauthenticated) }
                refreshBackendStatus()
            }
        }
    }

    fun refreshBackendStatus() {
        viewModelScope.launch {
            val url = sessionManager.getAppsScriptUrl()
            _ui.update { it.copy(appsScriptUrl = url, backendWarning = "") }
            if (url.isBlank()) {
                _ui.update {
                    it.copy(
                        backendStatus = null,
                        backendWarning = "Apps Script backend URL is not configured yet. Tap \"Configure Backend URL\" to connect."
                    )
                }
                return@launch
            }
            try {
                val el = api.postAction("auth.status", includeAuthToken = false)
                val status = api.json.decodeFromJsonElement<AuthStatusResponse>(el)
                _ui.update { it.copy(backendStatus = status, backendWarning = "") }
            } catch (e: Exception) {
                _ui.update {
                    it.copy(
                        backendStatus = null,
                        backendWarning = e.message ?: "Unable to reach the Apps Script backend."
                    )
                }
            }
        }
    }

    fun saveBackendUrl(url: String) {
        sessionManager.setAppsScriptUrl(url)
        _ui.update { it.copy(appsScriptUrl = url.trim(), loginError = "", toastMessage = "Backend URL saved.") }
        refreshBackendStatus()
    }

    fun signIn(usernameRaw: String, exactPassword: String) {
        viewModelScope.launch {
            val normalizedUser = usernameRaw.trim().lowercase()
            if (normalizedUser.isBlank() || exactPassword.isEmpty()) {
                _ui.update { it.copy(loginError = "Username and password are required.") }
                return@launch
            }
            _ui.update { it.copy(busy = true, loginError = "", backendWarning = "") }
            try {
                val el = api.postAction(
                    action = "auth.login",
                    payload = buildJsonObject {
                        put("username", normalizedUser)
                        // Treat password as EXACT value including symbols — never trim!
                        put("password", exactPassword)
                        put("device_id", sessionManager.getOrCreateDeviceId())
                        put("device_label", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
                    },
                    includeAuthToken = false
                )
                val resp = api.json.decodeFromJsonElement<LoginResponse>(el)
                sessionManager.saveSession(resp.token, resp.user)
                _ui.update {
                    it.copy(
                        busy = false,
                        authState = AuthGateState.Authenticated(resp.user),
                        toastMessage = resp.message.ifBlank { "Signed in as ${resp.user.name}" }
                    )
                }
                loadWorkspaceForUser(resp.user)
            } catch (e: InvalidCredentialsException) {
                _ui.update { it.copy(busy = false, loginError = e.message ?: "Invalid username or password.") }
            } catch (e: BackendUnconfiguredException) {
                _ui.update { it.copy(busy = false, backendWarning = e.message.orEmpty()) }
            } catch (e: BackendUnreachableException) {
                _ui.update { it.copy(busy = false, backendWarning = e.message.orEmpty()) }
            } catch (e: BackendSetupRequiredException) {
                _ui.update { it.copy(busy = false, backendWarning = e.message.orEmpty()) }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, loginError = e.message ?: "Sign-in failed.") }
            }
        }
    }

    fun resumeAfterUnlock(savedUser: AuthUser) {
        viewModelScope.launch {
            _ui.update { it.copy(busy = true) }
            try {
                api.postAction("auth.me")
                _ui.update { it.copy(busy = false, authState = AuthGateState.Authenticated(savedUser)) }
                loadWorkspaceForUser(savedUser)
            } catch (e: SessionRevokedException) {
                sessionManager.clearSession()
                _ui.update {
                    it.copy(
                        busy = false,
                        authState = AuthGateState.Unauthenticated,
                        loginError = e.message ?: "Your session was revoked. Please sign in with your password."
                    )
                }
            } catch (_: BackendUnreachableException) {
                // Allow viewing offline state while showing Pending Sync / Unreachable status
                _ui.update {
                    it.copy(
                        busy = false,
                        authState = AuthGateState.Authenticated(savedUser),
                        toastMessage = "Offline mode: changes will queue and sync when online."
                    )
                }
            } catch (e: Exception) {
                _ui.update {
                    it.copy(
                        busy = false,
                        authState = AuthGateState.Unauthenticated,
                        loginError = e.message ?: "Please sign in again."
                    )
                }
            }
        }
    }

    fun fallbackToPasswordLogin() {
        _ui.update { it.copy(authState = AuthGateState.Unauthenticated, loginError = "") }
    }

    fun signOut() {
        viewModelScope.launch {
            runCatching { api.postAction("auth.logout") }
            sessionManager.clearSession()
            _ui.update {
                it.copy(
                    authState = AuthGateState.Unauthenticated,
                    secondaryAccessToken = "",
                    secondaryVerifiedEmail = "",
                    secondaryVersions = emptyList(),
                    pendingRestoreJson = null,
                    pendingRestoreSummary = null,
                    toastMessage = "Signed out."
                )
            }
            refreshBackendStatus()
        }
    }

    // =========================================================================
    // FIRST-TIME ADMIN SETUP & EMAIL-CODE PASSWORD RECOVERY
    // =========================================================================

    suspend fun requestInitialSetupCode(): Result<String> {
        return try {
            val el = api.postAction(
                action = "auth.initial_setup_request_code",
                includeAuthToken = false
            )
            val resp = api.json.decodeFromJsonElement<AuthActionMessageResponse>(el)
            Result.success(
                resp.message.ifBlank {
                    "A 6-digit verification code has been sent to sunvilozltd@gmail.com. It expires in 10 minutes."
                }
            )
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun completeInitialSetup(
        usernameRaw: String,
        newPassword: String,
        confirmPassword: String,
        codeRaw: String
    ): Result<String> {
        val username = usernameRaw.trim().lowercase()
        val code = codeRaw.trim()
        if (username.length < 3 || username.contains(" ")) {
            return Result.failure(Exception("Admin Username must be at least 3 characters with no spaces."))
        }
        if (newPassword.length < 6) {
            return Result.failure(Exception("New Password must be at least 6 characters."))
        }
        if (newPassword != confirmPassword) {
            return Result.failure(Exception("New Password and Confirm Password do not match."))
        }
        if (!Regex("^\\d{6}$").matches(code)) {
            return Result.failure(Exception("Enter the 6-digit verification code sent to sunvilozltd@gmail.com."))
        }
        return try {
            val el = api.postAction(
                action = "auth.initial_setup_complete",
                payload = buildJsonObject {
                    put("username", username)
                    put("new_password", newPassword)
                    put("confirm_password", confirmPassword)
                    put("code", code)
                },
                includeAuthToken = false
            )
            val resp = api.json.decodeFromJsonElement<AuthActionMessageResponse>(el)
            val msg = resp.message.ifBlank {
                "Admin account setup complete. Please sign in with your new credentials."
            }
            _ui.update { it.copy(loginError = "", toastMessage = msg) }
            refreshBackendStatus()
            Result.success(msg)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun requestRecoveryCode(usernameRaw: String): Result<String> {
        val username = usernameRaw.trim().lowercase()
        if (username.isBlank()) {
            return Result.failure(Exception("Enter your current Admin Username."))
        }
        return try {
            val el = api.postAction(
                action = "auth.recovery_request_code",
                payload = buildJsonObject { put("username", username) },
                includeAuthToken = false
            )
            val resp = api.json.decodeFromJsonElement<AuthActionMessageResponse>(el)
            Result.success(
                resp.message.ifBlank {
                    "If the username matches an initialized admin account, a 6-digit recovery code has been sent to the registered owner recovery email. The code expires in 10 minutes."
                }
            )
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun verifyRecoveryCode(usernameRaw: String, codeRaw: String): Result<String> {
        val username = usernameRaw.trim().lowercase()
        val code = codeRaw.trim()
        if (username.isBlank()) {
            return Result.failure(Exception("Admin Username is required."))
        }
        if (!Regex("^\\d{6}$").matches(code)) {
            return Result.failure(Exception("Enter the 6-digit recovery code."))
        }
        return try {
            val el = api.postAction(
                action = "auth.recovery_verify_code",
                payload = buildJsonObject {
                    put("username", username)
                    put("code", code)
                },
                includeAuthToken = false
            )
            val resp = api.json.decodeFromJsonElement<AuthActionMessageResponse>(el)
            Result.success(resp.message.ifBlank { "Recovery code verified. Enter and confirm your new password." })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun completePasswordRecovery(
        usernameRaw: String,
        codeRaw: String,
        newPassword: String,
        confirmPassword: String
    ): Result<String> {
        val username = usernameRaw.trim().lowercase()
        val code = codeRaw.trim()
        if (username.isBlank()) {
            return Result.failure(Exception("Admin Username is required."))
        }
        if (!Regex("^\\d{6}$").matches(code)) {
            return Result.failure(Exception("Enter the 6-digit recovery code."))
        }
        if (newPassword.length < 6) {
            return Result.failure(Exception("New Password must be at least 6 characters."))
        }
        if (newPassword != confirmPassword) {
            return Result.failure(Exception("New Password and Confirm New Password do not match."))
        }
        return try {
            val el = api.postAction(
                action = "auth.recovery_complete",
                payload = buildJsonObject {
                    put("username", username)
                    put("code", code)
                    put("new_password", newPassword)
                    put("confirm_password", confirmPassword)
                },
                includeAuthToken = false
            )
            val resp = api.json.decodeFromJsonElement<AuthActionMessageResponse>(el)
            sessionManager.clearSession()
            val msg = resp.message.ifBlank {
                "Admin password reset complete. All previous sessions have been revoked. Please sign in with your new password."
            }
            _ui.update {
                it.copy(
                    authState = AuthGateState.Unauthenticated,
                    loginError = "",
                    secondaryAccessToken = "",
                    secondaryVerifiedEmail = "",
                    toastMessage = msg
                )
            }
            refreshBackendStatus()
            Result.success(msg)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun setDeviceUnlockEnabled(enabled: Boolean) {
        sessionManager.setDeviceUnlockEnabled(enabled)
        _ui.update { it.copy(deviceUnlockEnabled = enabled) }
    }

    fun loadWorkspaceForUser(user: AuthUser) {
        viewModelScope.launch {
            _ui.update { it.copy(busy = true) }
            try {
                // Flush any offline pending mutations safely before reloading
                syncRepo.flushQueue()
                if (user.isAdmin) {
                    val el = api.postAction("bootstrap")
                    val boot = api.json.decodeFromJsonElement<AdminBootstrapPayload>(el)
                    _ui.update { it.copy(busy = false, bootstrap = boot) }
                    val today = boot.todayDhaka.ifBlank { SunvilozConstants.todayDhakaIso() }
                    loadMonthlyReport(today.substring(0, 4).toInt(), today.substring(5, 7).toInt())
                } else {
                    val el = api.postAction("supervisor.jobs")
                    val sup = api.json.decodeFromJsonElement<SupervisorJobsPayload>(el)
                    _ui.update { it.copy(busy = false, supervisorJobs = sup) }
                }
            } catch (e: SessionRevokedException) {
                _ui.update {
                    it.copy(
                        busy = false,
                        authState = AuthGateState.Unauthenticated,
                        loginError = e.message ?: "Session revoked. Please sign in again."
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, toastMessage = e.message ?: "Sync failed.") }
            }
        }
    }

    fun retryPendingSync() {
        viewModelScope.launch {
            _ui.update { it.copy(busy = true) }
            val res = syncRepo.flushQueue()
            val user = (ui.value.authState as? AuthGateState.Authenticated)?.user
            if (res.syncedCount > 0 && user != null) {
                loadWorkspaceForUser(user)
            }
            _ui.update {
                it.copy(
                    busy = false,
                    toastMessage = when {
                        res.remainingCount == 0 -> "All pending changes saved to Google Sheets."
                        else -> "Sync Failed: ${res.lastError.ifBlank { "Still offline" }}"
                    }
                )
            }
        }
    }

    /**
     * Executes a write mutation with stable request_id.
     * On network failure, keeps the caller's form OPEN by returning Result.failure(...)
     * and optionally queuing for durable retry so the user clearly sees "Not Saved" + Retry.
     */
    suspend fun executeWrite(
        action: String,
        payload: JsonObject,
        label: String,
        requestId: String = "req-${UUID.randomUUID()}",
        queueIfOffline: Boolean = true
    ): Result<String> {
        return try {
            api.postAction(action = action, payload = payload, requestId = requestId)
            val user = (ui.value.authState as? AuthGateState.Authenticated)?.user
            if (user != null) loadWorkspaceForUser(user)
            _ui.update { it.copy(toastMessage = "Saved: $label") }
            Result.success("Saved")
        } catch (e: BackendUnreachableException) {
            if (queueIfOffline) {
                syncRepo.enqueueOffline(requestId, action, payload, label, e.message.orEmpty())
            }
            Result.failure(Exception("Not Saved (Offline — queued for Retry): ${e.message}"))
        } catch (e: SessionRevokedException) {
            _ui.update {
                it.copy(
                    authState = AuthGateState.Unauthenticated,
                    loginError = e.message ?: "Session revoked."
                )
            }
            Result.failure(e)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun createOrder(
        customerName: String,
        phone: String,
        address: String,
        area: String,
        serviceType: String,
        priceBdt: Double,
        bookingDate: String,
        scheduledDate: String,
        scheduledTime: String,
        supervisorId: String,
        advanceGiven: Double,
        notes: String,
        requestId: String
    ): Result<String> = executeWrite(
        action = "orders.create",
        payload = buildJsonObject {
            put("customer_name", customerName.trim())
            put("phone", phone.trim())
            put("address", address.trim())
            put("area", area.trim())
            put("service_type", serviceType)
            put("price_bdt", priceBdt)
            put("booking_date", bookingDate)
            put("scheduled_date", scheduledDate)
            put("scheduled_time", scheduledTime)
            put("assigned_supervisor_id", supervisorId)
            put("advance_given", advanceGiven)
            put("notes", notes.trim())
        },
        label = "Order for $customerName",
        requestId = requestId
    )

    suspend fun completeOrder(
        orderId: String,
        transportCost: Double,
        mealsCost: Double,
        otherExpenses: List<OtherExpenseItem>,
        fullBillCollected: Boolean,
        requestId: String
    ): Result<String> = executeWrite(
        action = "orders.complete",
        payload = buildJsonObject {
            put("order_id", orderId)
            put("transport_cost", transportCost)
            put("meals_cost", mealsCost)
            put("full_bill_collected", fullBillCollected)
            put("other_expenses", buildJsonArray {
                otherExpenses.forEach { oe ->
                    add(buildJsonObject {
                        put("description", oe.description)
                        put("amount", oe.amount)
                    })
                }
            })
        },
        label = "Complete $orderId",
        requestId = requestId
    )

    suspend fun changeOrderStatus(orderId: String, status: String): Result<String> =
        executeWrite(
            action = "orders.status",
            payload = buildJsonObject {
                put("order_id", orderId)
                put("status", status)
            },
            label = "Status $orderId -> $status",
            queueIfOffline = false
        )

    suspend fun saveQuotation(
        customerName: String,
        phone: String,
        address: String,
        area: String,
        items: List<QuotationItem>,
        discountBdt: Double,
        notes: String,
        requestId: String
    ): Result<String> = executeWrite(
        action = "quotations.save",
        payload = buildJsonObject {
            put("customer_name", customerName.trim())
            put("phone", phone.trim())
            put("address", address.trim())
            put("area", area.trim())
            put("discount_bdt", discountBdt)
            put("notes", notes.trim())
            put("items", buildJsonArray {
                items.forEach { it ->
                    add(buildJsonObject {
                        put("service_type", it.serviceType)
                        put("description", it.description)
                        put("amount_bdt", it.amountBdt)
                    })
                }
            })
        },
        label = "Quotation for $customerName",
        requestId = requestId
    )

    suspend fun convertQuotationToOrder(quotationId: String, scheduledDate: String): Result<String> =
        executeWrite(
            action = "quotations.convert",
            payload = buildJsonObject {
                put("quotation_id", quotationId)
                put("scheduled_date", scheduledDate)
            },
            label = "Convert Quotation $quotationId",
            queueIfOffline = false
        )

    suspend fun issueMoneyReceipt(orderId: String, paymentMethod: String): Result<String> =
        executeWrite(
            action = "receipts.issue",
            payload = buildJsonObject {
                put("order_id", orderId)
                put("payment_method", paymentMethod)
            },
            label = "Money Receipt $orderId",
            queueIfOffline = false
        )

    suspend fun createSupervisor(name: String, username: String, phone: String, password: String): Result<String> =
        executeWrite(
            action = "supervisors.create",
            payload = buildJsonObject {
                put("name", name.trim())
                put("username", username.trim().lowercase())
                put("phone", phone.trim())
                put("password", password)
            },
            label = "Create Supervisor $name",
            queueIfOffline = false
        )

    suspend fun updateAdminCredentials(
        currentPassword: String,
        newUsernameRaw: String,
        newPassword: String,
        confirmNewPassword: String
    ): Result<String> {
        if (currentPassword.isEmpty()) {
            return Result.failure(Exception("Current Password is required before making account changes."))
        }
        val cleanUser = newUsernameRaw.trim().lowercase()
        if (cleanUser.length < 3 || cleanUser.contains(" ")) {
            return Result.failure(Exception("Admin Username must be at least 3 characters with no spaces."))
        }
        if (newPassword.isNotEmpty()) {
            if (newPassword.length < 6) {
                return Result.failure(Exception("New Password must be at least 6 characters."))
            }
            if (newPassword != confirmNewPassword) {
                return Result.failure(Exception("New Password and Confirm New Password do not match."))
            }
            if (newPassword == currentPassword) {
                return Result.failure(Exception("New Password must be different from your Current Password."))
            }
        }
        return try {
            val el = api.postAction(
                action = "auth.update_admin_credentials",
                payload = buildJsonObject {
                    put("current_password", currentPassword)
                    put("new_username", cleanUser)
                    if (newPassword.isNotEmpty()) {
                        put("new_password", newPassword)
                        put("confirm_new_password", confirmNewPassword)
                    }
                }
            )
            val resp = api.json.decodeFromJsonElement<AuthActionMessageResponse>(el)
            val msg = resp.message.ifBlank {
                "Admin credentials updated. All previous sessions have been revoked. Please sign in with your updated credentials."
            }
            // Server revoked all previous admin sessions; clear local session and return to Sign In.
            // Fingerprint / screen-lock unlock may resume after signing in with updated credentials.
            sessionManager.clearSession()
            _ui.update {
                it.copy(
                    authState = AuthGateState.Unauthenticated,
                    loginError = "",
                    secondaryAccessToken = "",
                    secondaryVerifiedEmail = "",
                    secondaryVersions = emptyList(),
                    pendingRestoreJson = null,
                    pendingRestoreSummary = null,
                    toastMessage = msg
                )
            }
            refreshBackendStatus()
            Result.success(msg)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun loadMonthlyReport(year: Int, month: Int, area: String = "", service: String = "", supervisorId: String = "") {
        viewModelScope.launch {
            runCatching {
                val el = api.postAction(
                    action = "reports.monthly",
                    payload = buildJsonObject {
                        put("year", year)
                        put("month", month)
                        if (area.isNotBlank()) put("area", area)
                        if (service.isNotBlank()) put("service", service)
                        if (supervisorId.isNotBlank()) put("supervisor_id", supervisorId)
                    }
                )
                api.json.decodeFromJsonElement<MonthlyReportPayload>(el)
            }.onSuccess { report ->
                _ui.update { it.copy(monthlyReport = report) }
            }
        }
    }

    // =========================================================================
    // SECONDARY GOOGLE DRIVE BACKUP & RESTORE (ADMIN-ONLY)
    // =========================================================================

    fun onSecondaryGoogleAuthorized(accessToken: String) {
        viewModelScope.launch {
            _ui.update { it.copy(backupBusy = true) }
            try {
                val verifiedEmail = backupManager.fetchVerifiedGoogleEmail(accessToken)
                val primaryOwner = ui.value.bootstrap.settings.primaryOwnerGoogleEmail
                backupManager.assertNotPrimaryAccount(verifiedEmail, primaryOwner)
                val versions = backupManager.listDatedBackupVersions(
                    accessToken,
                    ui.value.bootstrap.settings.secondaryDriveFolderName
                )
                _ui.update {
                    it.copy(
                        backupBusy = false,
                        secondaryAccessToken = accessToken,
                        secondaryVerifiedEmail = verifiedEmail,
                        secondaryVersions = versions,
                        toastMessage = "Secondary Drive connected ($verifiedEmail)."
                    )
                }
            } catch (e: Exception) {
                _ui.update {
                    it.copy(
                        backupBusy = false,
                        secondaryAccessToken = "",
                        secondaryVerifiedEmail = "",
                        toastMessage = e.message ?: "Secondary account authorization rejected."
                    )
                }
            }
        }
    }

    fun runBackUpNow() {
        val token = ui.value.secondaryAccessToken
        if (token.isBlank()) {
            _ui.update { it.copy(toastMessage = "Authorize a second Google account first.") }
            return
        }
        viewModelScope.launch {
            _ui.update { it.copy(backupBusy = true) }
            try {
                val primaryEmail = ui.value.bootstrap.settings.primaryOwnerGoogleEmail
                val folder = ui.value.bootstrap.settings.secondaryDriveFolderName
                val outcome = backupManager.runManualBackupNow(token, primaryEmail, folder)
                val versions = backupManager.listDatedBackupVersions(token, folder)
                _ui.update {
                    it.copy(
                        backupBusy = false,
                        secondaryVersions = versions,
                        toastMessage = "Verified backup saved: ${outcome.fileName}"
                    )
                }
                (ui.value.authState as? AuthGateState.Authenticated)?.user?.let { loadWorkspaceForUser(it) }
            } catch (e: Exception) {
                _ui.update { it.copy(backupBusy = false, toastMessage = "Backup Failed: ${e.message}") }
            }
        }
    }

    fun saveSecondaryScheduledBridge(webappUrl: String, secret: String, autoEnabled: Boolean) {
        viewModelScope.launch {
            _ui.update { it.copy(backupBusy = true) }
            try {
                api.postAction(
                    action = "backup.configure_secondary",
                    payload = buildJsonObject {
                        put("secondary_drive_email", ui.value.secondaryVerifiedEmail)
                        put("secondary_drive_webapp_url", webappUrl.trim())
                        put("secondary_drive_sync_secret", secret.trim())
                        put("auto_backup_enabled", autoEnabled)
                        put("auto_backup_hour", 2)
                    }
                )
                _ui.update { it.copy(backupBusy = false, toastMessage = "Daily scheduled backup bridge saved.") }
                (ui.value.authState as? AuthGateState.Authenticated)?.user?.let { loadWorkspaceForUser(it) }
            } catch (e: Exception) {
                _ui.update { it.copy(backupBusy = false, toastMessage = e.message ?: "Failed to save schedule.") }
            }
        }
    }

    fun previewRestoreFromSecondaryFile(fileId: String) {
        val token = ui.value.secondaryAccessToken
        if (token.isBlank()) return
        viewModelScope.launch {
            _ui.update { it.copy(backupBusy = true) }
            try {
                val (obj, summary) = backupManager.previewBackupFromSecondaryDrive(token, fileId)
                _ui.update { it.copy(backupBusy = false, pendingRestoreJson = obj, pendingRestoreSummary = summary) }
            } catch (e: Exception) {
                _ui.update { it.copy(backupBusy = false, toastMessage = "Restore validation failed: ${e.message}") }
            }
        }
    }

    fun previewRestoreFromLocalFile(uri: Uri) {
        viewModelScope.launch {
            _ui.update { it.copy(backupBusy = true) }
            try {
                val (obj, summary) = backupManager.previewBackupFromLocalUri(uri)
                _ui.update { it.copy(backupBusy = false, pendingRestoreJson = obj, pendingRestoreSummary = summary) }
            } catch (e: Exception) {
                _ui.update { it.copy(backupBusy = false, toastMessage = "Invalid backup file: ${e.message}") }
            }
        }
    }

    fun cancelRestorePreview() {
        _ui.update { it.copy(pendingRestoreJson = null, pendingRestoreSummary = null) }
    }

    fun confirmRestoreBackup() {
        val backupObj = ui.value.pendingRestoreJson ?: return
        viewModelScope.launch {
            _ui.update { it.copy(backupBusy = true) }
            try {
                val msg = backupManager.confirmRestore(backupObj, "restore-${UUID.randomUUID()}")
                _ui.update {
                    it.copy(
                        backupBusy = false,
                        pendingRestoreJson = null,
                        pendingRestoreSummary = null,
                        toastMessage = msg
                    )
                }
                (ui.value.authState as? AuthGateState.Authenticated)?.user?.let { loadWorkspaceForUser(it) }
            } catch (e: Exception) {
                _ui.update { it.copy(backupBusy = false, toastMessage = "Restore Failed (existing data preserved): ${e.message}") }
            }
        }
    }
}
