package com.sunviloz.cleancare

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.content.FileProvider
import androidx.fragment.app.FragmentActivity
import com.sunviloz.cleancare.data.docs.DocumentExportEngine
import com.sunviloz.cleancare.data.security.BiometricUnlockHelper
import com.sunviloz.cleancare.ui.AuthGateState
import com.sunviloz.cleancare.ui.MainViewModel
import com.sunviloz.cleancare.ui.screens.AdminDashboardScreen
import com.sunviloz.cleancare.ui.screens.AdminOrdersScreen
import com.sunviloz.cleancare.ui.screens.AdminQuotationsScreen
import com.sunviloz.cleancare.ui.screens.AdminReportsScreen
import com.sunviloz.cleancare.ui.screens.AdminSettingsAndBackupScreen
import com.sunviloz.cleancare.ui.screens.BiometricUnlockGateScreen
import com.sunviloz.cleancare.ui.screens.LoginScreen
import com.sunviloz.cleancare.ui.screens.SupervisorHomeScreen
import com.sunviloz.cleancare.ui.screens.SyncStatusBanner
import com.sunviloz.cleancare.ui.theme.SunvilozTheme
import java.io.File

class MainActivity : FragmentActivity() {

    private val vm: MainViewModel by viewModels()

    private val secondaryAuthLauncher = registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK && result.data != null) {
            runCatching {
                val authRes = vm.backupManager.authorizationClient().getAuthorizationResultFromIntent(result.data)
                authRes.accessToken?.let { vm.onSecondaryGoogleAuthorized(it) }
            }
        }
    }

    private val localBackupPicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) {
            vm.previewRestoreFromLocalFile(uri)
        }
    }

    private fun startSecondaryGoogleDriveAuth() {
        val req = vm.backupManager.buildGoogleAuthorizationRequest()
        vm.backupManager.authorizationClient()
            .authorize(req)
            .addOnSuccessListener { authRes ->
                if (authRes.hasResolution()) {
                    val intentSender = authRes.pendingIntent?.intentSender ?: return@addOnSuccessListener
                    secondaryAuthLauncher.launch(IntentSenderRequest.Builder(intentSender).build())
                } else {
                    authRes.accessToken?.let { vm.onSecondaryGoogleAuthorized(it) }
                }
            }
    }

    private fun shareExportedFile(file: File, mimeType: String) {
        val uri = FileProvider.getUriForFile(this, "${packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(intent, "Share ${file.name}"))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            SunvilozTheme {
                val state by vm.ui.collectAsState()
                val queue by vm.pendingQueue.collectAsState()
                val snackbarHostState = remember { SnackbarHostState() }

                LaunchedEffect(state.toastMessage) {
                    if (state.toastMessage.isNotBlank()) {
                        snackbarHostState.showSnackbar(state.toastMessage)
                        vm.clearToast()
                    }
                }

                when (val auth = state.authState) {
                    AuthGateState.Loading -> {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    }

                    is AuthGateState.BiometricLock -> {
                        LaunchedEffect(auth.user.id) {
                            if (BiometricUnlockHelper.canUseDeviceUnlock(this@MainActivity)) {
                                BiometricUnlockHelper.promptUnlock(
                                    activity = this@MainActivity,
                                    accountLabel = auth.user.username,
                                    onSuccess = { vm.resumeAfterUnlock(auth.user) },
                                    onFallbackToPassword = { vm.fallbackToPasswordLogin() },
                                    onError = { vm.fallbackToPasswordLogin() }
                                )
                            }
                        }
                        BiometricUnlockGateScreen(
                            user = auth.user,
                            onRequestBiometric = {
                                BiometricUnlockHelper.promptUnlock(
                                    activity = this@MainActivity,
                                    accountLabel = auth.user.username,
                                    onSuccess = { vm.resumeAfterUnlock(auth.user) },
                                    onFallbackToPassword = { vm.fallbackToPasswordLogin() },
                                    onError = { vm.fallbackToPasswordLogin() }
                                )
                            },
                            onUsePasswordInstead = { vm.fallbackToPasswordLogin() }
                        )
                    }

                    AuthGateState.Unauthenticated -> {
                        Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { pad ->
                            Box(Modifier.padding(pad)) {
                                LoginScreen(
                                    state = state,
                                    onSignIn = { u, p -> vm.signIn(u, p) },
                                    onRequestInitialSetupCode = { vm.requestInitialSetupCode() },
                                    onCompleteInitialSetup = { u, p, c, code -> vm.completeInitialSetup(u, p, c, code) },
                                    onRequestRecoveryCode = { u -> vm.requestRecoveryCode(u) },
                                    onVerifyRecoveryCode = { u, code -> vm.verifyRecoveryCode(u, code) },
                                    onCompleteRecovery = { u, code, p, c -> vm.completePasswordRecovery(u, code, p, c) },
                                    onSaveBackendUrl = { vm.saveBackendUrl(it) },
                                    onRetryStatus = { vm.refreshBackendStatus() }
                                )
                            }
                        }
                    }

                    is AuthGateState.Authenticated -> {
                        if (!auth.user.isAdmin) {
                            Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { pad ->
                                Column(Modifier.padding(pad).fillMaxSize()) {
                                    SyncStatusBanner(
                                        badge = state.syncBadge,
                                        pendingCount = queue.size,
                                        lastError = state.lastSyncError,
                                        onRetry = { vm.retryPendingSync() }
                                    )
                                    SupervisorHomeScreen(
                                        state = state,
                                        vm = vm,
                                        onSignOut = { vm.signOut() }
                                    )
                                }
                            }
                        } else {
                            var tab by remember { mutableIntStateOf(0) }
                            Scaffold(
                                snackbarHost = { SnackbarHost(snackbarHostState) },
                                bottomBar = {
                                    NavigationBar {
                                        NavigationBarItem(selected = tab == 0, onClick = { tab = 0 }, icon = { Icon(Icons.Default.Dashboard, null) }, label = { Text("Home") })
                                        NavigationBarItem(selected = tab == 1, onClick = { tab = 1 }, icon = { Icon(Icons.Default.ListAlt, null) }, label = { Text("Orders") })
                                        NavigationBarItem(selected = tab == 2, onClick = { tab = 2 }, icon = { Icon(Icons.Default.Description, null) }, label = { Text("Quotes") })
                                        NavigationBarItem(selected = tab == 3, onClick = { tab = 3 }, icon = { Icon(Icons.Default.BarChart, null) }, label = { Text("Reports") })
                                        NavigationBarItem(selected = tab == 4, onClick = { tab = 4 }, icon = { Icon(Icons.Default.Settings, null) }, label = { Text("Settings") })
                                    }
                                }
                            ) { pad ->
                                Column(Modifier.padding(pad).fillMaxSize()) {
                                    SyncStatusBanner(
                                        badge = state.syncBadge,
                                        pendingCount = queue.size,
                                        lastError = state.lastSyncError,
                                        onRetry = { vm.retryPendingSync() }
                                    )
                                    when (tab) {
                                        0 -> AdminDashboardScreen(state = state, onRefresh = { vm.loadWorkspaceForUser(auth.user) })
                                        1 -> AdminOrdersScreen(
                                            state = state,
                                            vm = vm,
                                            onExportReceiptPdf = { rec ->
                                                val file = DocumentExportEngine.generateMoneyReceiptPdf(this@MainActivity, rec)
                                                shareExportedFile(file, "application/pdf")
                                            }
                                        )
                                        2 -> AdminQuotationsScreen(
                                            state = state,
                                            vm = vm,
                                            onExportQuotationPdf = { q ->
                                                val file = DocumentExportEngine.generateQuotationPdf(this@MainActivity, q)
                                                shareExportedFile(file, "application/pdf")
                                            }
                                        )
                                        3 -> AdminReportsScreen(
                                            state = state,
                                            vm = vm,
                                            onExportExcel = {
                                                val file = DocumentExportEngine.generateMonthlyReportXlsx(this@MainActivity, state.monthlyReport)
                                                shareExportedFile(file, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                                            }
                                        )
                                        4 -> AdminSettingsAndBackupScreen(
                                            currentUser = auth.user,
                                            state = state,
                                            vm = vm,
                                            onAuthorizeSecondaryGoogle = { startSecondaryGoogleDriveAuth() },
                                            onPickLocalBackupFile = { localBackupPicker.launch(arrayOf("application/json", "*/*")) },
                                            onSignOut = { vm.signOut() }
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
