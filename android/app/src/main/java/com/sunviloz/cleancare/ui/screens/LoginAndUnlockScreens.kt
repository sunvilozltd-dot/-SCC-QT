package com.sunviloz.cleancare.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.res.painterResource
import com.sunviloz.cleancare.R
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.sunviloz.cleancare.data.model.AuthUser
import com.sunviloz.cleancare.ui.AppUiState
import com.sunviloz.cleancare.ui.theme.AmberBg
import com.sunviloz.cleancare.ui.theme.AmberWarning
import com.sunviloz.cleancare.ui.theme.NavyPrimary
import com.sunviloz.cleancare.ui.theme.RedError
import com.sunviloz.cleancare.ui.theme.SlateSurface
import kotlinx.coroutines.launch

private enum class AuthScreenMode {
    SIGN_IN,
    INITIAL_SETUP,
    FORGOT_PASSWORD
}

@Composable
fun LoginScreen(
    state: AppUiState,
    onSignIn: (String, String) -> Unit,
    onRequestInitialSetupCode: suspend () -> Result<String>,
    onCompleteInitialSetup: suspend (String, String, String, String) -> Result<String>,
    onRequestRecoveryCode: suspend (String) -> Result<String>,
    onVerifyRecoveryCode: suspend (String, String) -> Result<String>,
    onCompleteRecovery: suspend (String, String, String, String) -> Result<String>,
    onSaveBackendUrl: (String) -> Unit,
    onRetryStatus: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf(AuthScreenMode.SIGN_IN) }

    // Sign-In fields
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var showBackendDialog by remember { mutableStateOf(false) }

    val needsInitialSetup = state.backendStatus?.needsInitialAdminSetup == true
    val adminConfigured = state.backendStatus?.adminConfigured == true
    val recoveryEmail = state.backendStatus?.recoveryRecipientEmail?.ifBlank { "sunvilozltd@gmail.com" }
        ?: "sunvilozltd@gmail.com"

    // Immediately disable Initial Setup view once backend confirms admin password is initialized
    LaunchedEffect(needsInitialSetup) {
        if (mode == AuthScreenMode.INITIAL_SETUP && !needsInitialSetup) {
            mode = AuthScreenMode.SIGN_IN
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SlateSurface)
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color.White),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            Column(modifier = Modifier.padding(22.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Image(
                        painter = painterResource(id = R.drawable.sunviloz_logo),
                        contentDescription = "SUNVILOZ Clean Care Logo",
                        modifier = Modifier.size(44.dp)
                    )
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(
                            text = "SUNVILOZ Clean Care",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                            color = NavyPrimary
                        )
                        Text(
                            text = "Operations, Orders & Accounts",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }

                // Distinct banner for unconfigured / unreachable Apps Script backend
                if (state.backendWarning.isNotBlank()) {
                    Spacer(Modifier.height(12.dp))
                    Card(colors = CardDefaults.cardColors(containerColor = AmberBg)) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                text = "Apps Script Backend Notice",
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.Bold,
                                color = AmberWarning
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = state.backendWarning,
                                style = MaterialTheme.typography.bodySmall,
                                color = AmberWarning
                            )
                            Spacer(Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { showBackendDialog = true }) {
                                    Text("Configure Backend URL")
                                }
                                TextButton(onClick = onRetryStatus) {
                                    Text("Retry")
                                }
                            }
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))

                when (mode) {
                    AuthScreenMode.SIGN_IN -> {
                        Text(
                            text = "Sign In to Your Account",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            text = "Sign in with your saved admin credentials or admin-assigned supervisor account.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF64748B)
                        )

                        // Show "Set Up Admin Account" ONLY when Apps Script confirms password has never been initialized
                        if (needsInitialSetup) {
                            Spacer(Modifier.height(12.dp))
                            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFECFDF5))) {
                                Column(
                                    modifier = Modifier.padding(14.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Text(
                                        text = "First-Time Admin Setup Required",
                                        style = MaterialTheme.typography.labelLarge,
                                        fontWeight = FontWeight.Bold,
                                        color = Color(0xFF065F46)
                                    )
                                    Text(
                                        text = "The administrator password has not been initialized yet. Complete first-time setup with a one-time email verification code sent to $recoveryEmail.",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Color(0xFF064E3B)
                                    )
                                    Button(
                                        onClick = { mode = AuthScreenMode.INITIAL_SETUP },
                                        modifier = Modifier.fillMaxWidth()
                                    ) {
                                        Icon(Icons.Default.AdminPanelSettings, contentDescription = null)
                                        Spacer(Modifier.padding(4.dp))
                                        Text("Set Up Admin Account")
                                    }
                                }
                            }
                        }

                        // Rejected credential error banner
                        if (state.loginError.isNotBlank()) {
                            Spacer(Modifier.height(12.dp))
                            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFEF2F2))) {
                                Column(modifier = Modifier.padding(12.dp)) {
                                    Text(
                                        text = state.loginError,
                                        style = MaterialTheme.typography.bodySmall,
                                        fontWeight = FontWeight.Medium,
                                        color = RedError
                                    )
                                    if (adminConfigured) {
                                        Spacer(Modifier.height(6.dp))
                                        TextButton(
                                            onClick = { mode = AuthScreenMode.FORGOT_PASSWORD }
                                        ) {
                                            Text("Forgot Password? Recover with Email Code")
                                        }
                                    }
                                }
                            }
                        }

                        Spacer(Modifier.height(16.dp))
                        OutlinedTextField(
                            value = username,
                            onValueChange = { username = it },
                            label = { Text("Username") },
                            placeholder = { Text("Enter admin or supervisor username") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                            modifier = Modifier.fillMaxWidth()
                        )

                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            label = { Text("Password") },
                            singleLine = true,
                            visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                            trailingIcon = {
                                IconButton(onClick = { showPassword = !showPassword }) {
                                    Icon(
                                        imageVector = if (showPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                        contentDescription = if (showPassword) "Hide password" else "Show password"
                                    )
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        )

                        Spacer(Modifier.height(18.dp))
                        Button(
                            onClick = { onSignIn(username, password) },
                            enabled = !state.busy,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp)
                        ) {
                            if (state.busy) {
                                CircularProgressIndicator(strokeWidth = 2.dp, color = Color.White)
                            } else {
                                Icon(Icons.Default.Lock, contentDescription = null)
                                Spacer(Modifier.padding(4.dp))
                                Text("Sign In")
                            }
                        }

                        Spacer(Modifier.height(10.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            if (!needsInitialSetup) {
                                TextButton(onClick = { mode = AuthScreenMode.FORGOT_PASSWORD }) {
                                    Text("Forgot Password?")
                                }
                            } else {
                                Spacer(Modifier.padding(1.dp))
                            }
                            TextButton(onClick = { showBackendDialog = true }) {
                                Icon(Icons.Default.Settings, contentDescription = null)
                                Spacer(Modifier.padding(3.dp))
                                Text(
                                    if (state.appsScriptUrl.isBlank()) "Configure Backend URL"
                                    else "Backend Connection"
                                )
                            }
                        }
                    }

                    AuthScreenMode.INITIAL_SETUP -> {
                        val defaultInitialUser = state.backendStatus?.initialAdminUsername
                            ?.ifBlank { "scc@gmail.com" } ?: "scc@gmail.com"
                        var setupUser by remember(defaultInitialUser) { mutableStateOf(defaultInitialUser) }
                        var setupNewPass by remember { mutableStateOf("") }
                        var setupConfirmPass by remember { mutableStateOf("") }
                        var setupCode by remember { mutableStateOf("") }
                        var showSetupNew by remember { mutableStateOf(false) }
                        var showSetupConfirm by remember { mutableStateOf(false) }
                        var setupCodeSent by remember { mutableStateOf(false) }
                        var setupBusy by remember { mutableStateOf(false) }
                        var setupInfo by remember { mutableStateOf("") }
                        var setupError by remember { mutableStateOf("") }

                        Text(
                            text = "Set Up Admin Account",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = NavyPrimary
                        )
                        Text(
                            text = "Set your initial Admin Username and Password. A 6-digit verification code will be sent only to $recoveryEmail. Existing business data and admin ID are preserved.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF64748B)
                        )

                        if (setupError.isNotBlank()) {
                            Spacer(Modifier.height(10.dp))
                            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFEF2F2))) {
                                Text(
                                    text = setupError,
                                    color = RedError,
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.padding(12.dp)
                                )
                            }
                        }
                        if (setupInfo.isNotBlank()) {
                            Spacer(Modifier.height(10.dp))
                            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFECFDF5))) {
                                Text(
                                    text = setupInfo,
                                    color = Color(0xFF065F46),
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.padding(12.dp)
                                )
                            }
                        }

                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = setupUser,
                            onValueChange = { setupUser = it },
                            label = { Text("Admin Username *") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                            modifier = Modifier.fillMaxWidth()
                        )

                        Spacer(Modifier.height(10.dp))
                        OutlinedTextField(
                            value = setupNewPass,
                            onValueChange = { setupNewPass = it },
                            label = { Text("New Password (min 6 chars) *") },
                            singleLine = true,
                            visualTransformation = if (showSetupNew) VisualTransformation.None else PasswordVisualTransformation(),
                            trailingIcon = {
                                IconButton(onClick = { showSetupNew = !showSetupNew }) {
                                    Icon(
                                        imageVector = if (showSetupNew) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                        contentDescription = if (showSetupNew) "Hide password" else "Show password"
                                    )
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        )

                        Spacer(Modifier.height(10.dp))
                        OutlinedTextField(
                            value = setupConfirmPass,
                            onValueChange = { setupConfirmPass = it },
                            label = { Text("Confirm Password *") },
                            singleLine = true,
                            visualTransformation = if (showSetupConfirm) VisualTransformation.None else PasswordVisualTransformation(),
                            trailingIcon = {
                                IconButton(onClick = { showSetupConfirm = !showSetupConfirm }) {
                                    Icon(
                                        imageVector = if (showSetupConfirm) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                        contentDescription = if (showSetupConfirm) "Hide password" else "Show password"
                                    )
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        )

                        Spacer(Modifier.height(12.dp))
                        HorizontalDivider()
                        Spacer(Modifier.height(12.dp))

                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    setupBusy = true
                                    setupError = ""
                                    setupInfo = ""
                                    val res = onRequestInitialSetupCode()
                                    setupBusy = false
                                    res.fold(
                                        onSuccess = {
                                            setupCodeSent = true
                                            setupInfo = it
                                        },
                                        onFailure = { setupError = it.message ?: "Unable to send verification code." }
                                    )
                                }
                            },
                            enabled = !setupBusy,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Default.MarkEmailRead, contentDescription = null)
                            Spacer(Modifier.padding(4.dp))
                            Text(if (setupCodeSent) "Resend Verification Code to $recoveryEmail" else "Send Verification Code to $recoveryEmail")
                        }

                        Spacer(Modifier.height(10.dp))
                        OutlinedTextField(
                            value = setupCode,
                            onValueChange = { setupCode = it.filter { ch -> ch.isDigit() }.take(6) },
                            label = { Text("6-Digit Verification Code *") },
                            placeholder = { Text("Enter 6-digit code from email") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.fillMaxWidth()
                        )

                        Spacer(Modifier.height(16.dp))
                        Button(
                            onClick = {
                                scope.launch {
                                    setupBusy = true
                                    setupError = ""
                                    val res = onCompleteInitialSetup(setupUser, setupNewPass, setupConfirmPass, setupCode)
                                    setupBusy = false
                                    res.fold(
                                        onSuccess = {
                                            username = setupUser.trim().lowercase()
                                            password = ""
                                            mode = AuthScreenMode.SIGN_IN
                                        },
                                        onFailure = { setupError = it.message ?: "Admin setup failed." }
                                    )
                                }
                            },
                            enabled = !setupBusy,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp)
                        ) {
                            if (setupBusy) {
                                CircularProgressIndicator(strokeWidth = 2.dp, color = Color.White)
                            } else {
                                Text("Verify & Save Admin Account")
                            }
                        }

                        Spacer(Modifier.height(8.dp))
                        TextButton(
                            onClick = { mode = AuthScreenMode.SIGN_IN },
                            modifier = Modifier.align(Alignment.Start)
                        ) {
                            Icon(Icons.Default.ArrowBack, contentDescription = null)
                            Spacer(Modifier.padding(3.dp))
                            Text("Back to Sign In")
                        }
                    }

                    AuthScreenMode.FORGOT_PASSWORD -> {
                        var recUser by remember { mutableStateOf(username) }
                        var recCode by remember { mutableStateOf("") }
                        var recNewPass by remember { mutableStateOf("") }
                        var recConfirmPass by remember { mutableStateOf("") }
                        var showRecNew by remember { mutableStateOf(false) }
                        var showRecConfirm by remember { mutableStateOf(false) }
                        var codeRequested by remember { mutableStateOf(false) }
                        var codeVerified by remember { mutableStateOf(false) }
                        var recBusy by remember { mutableStateOf(false) }
                        var recInfo by remember { mutableStateOf("") }
                        var recError by remember { mutableStateOf("") }

                        Text(
                            text = "Forgot Admin Password",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = NavyPrimary
                        )
                        Text(
                            text = "Enter your current Admin Username. A one-time recovery code is sent only to the fixed owner recovery email ($recoveryEmail) and expires in 10 minutes.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF64748B)
                        )

                        if (recError.isNotBlank()) {
                            Spacer(Modifier.height(10.dp))
                            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFEF2F2))) {
                                Text(
                                    text = recError,
                                    color = RedError,
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.padding(12.dp)
                                )
                            }
                        }
                        if (recInfo.isNotBlank()) {
                            Spacer(Modifier.height(10.dp))
                            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFECFDF5))) {
                                Text(
                                    text = recInfo,
                                    color = Color(0xFF065F46),
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.padding(12.dp)
                                )
                            }
                        }

                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = recUser,
                            onValueChange = {
                                recUser = it
                                codeVerified = false
                            },
                            label = { Text("Current Admin Username *") },
                            singleLine = true,
                            enabled = !recBusy,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                            modifier = Modifier.fillMaxWidth()
                        )

                        Spacer(Modifier.height(10.dp))
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    recBusy = true
                                    recError = ""
                                    recInfo = ""
                                    codeVerified = false
                                    val res = onRequestRecoveryCode(recUser)
                                    recBusy = false
                                    res.fold(
                                        onSuccess = {
                                            codeRequested = true
                                            recInfo = it
                                        },
                                        onFailure = { recError = it.message ?: "Unable to request recovery code." }
                                    )
                                }
                            },
                            enabled = !recBusy,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Default.MarkEmailRead, contentDescription = null)
                            Spacer(Modifier.padding(4.dp))
                            Text(if (codeRequested) "Resend Recovery Code" else "Send Recovery Code")
                        }

                        if (codeRequested) {
                            Spacer(Modifier.height(12.dp))
                            HorizontalDivider()
                            Spacer(Modifier.height(12.dp))

                            OutlinedTextField(
                                value = recCode,
                                onValueChange = {
                                    recCode = it.filter { ch -> ch.isDigit() }.take(6)
                                    codeVerified = false
                                },
                                label = { Text("6-Digit Recovery Code *") },
                                placeholder = { Text("Enter 6-digit code from $recoveryEmail") },
                                singleLine = true,
                                enabled = !recBusy,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                modifier = Modifier.fillMaxWidth()
                            )

                            if (!codeVerified) {
                                Spacer(Modifier.height(10.dp))
                                Button(
                                    onClick = {
                                        scope.launch {
                                            recBusy = true
                                            recError = ""
                                            val res = onVerifyRecoveryCode(recUser, recCode)
                                            recBusy = false
                                            res.fold(
                                                onSuccess = {
                                                    codeVerified = true
                                                    recInfo = it
                                                },
                                                onFailure = { recError = it.message ?: "Invalid recovery code." }
                                            )
                                        }
                                    },
                                    enabled = !recBusy,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text("Verify Recovery Code")
                                }
                            }
                        }

                        if (codeVerified) {
                            Spacer(Modifier.height(12.dp))
                            HorizontalDivider()
                            Spacer(Modifier.height(12.dp))

                            OutlinedTextField(
                                value = recNewPass,
                                onValueChange = { recNewPass = it },
                                label = { Text("New Password (min 6 chars) *") },
                                singleLine = true,
                                visualTransformation = if (showRecNew) VisualTransformation.None else PasswordVisualTransformation(),
                                trailingIcon = {
                                    IconButton(onClick = { showRecNew = !showRecNew }) {
                                        Icon(
                                            imageVector = if (showRecNew) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                            contentDescription = if (showRecNew) "Hide password" else "Show password"
                                        )
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            )

                            Spacer(Modifier.height(10.dp))
                            OutlinedTextField(
                                value = recConfirmPass,
                                onValueChange = { recConfirmPass = it },
                                label = { Text("Confirm New Password *") },
                                singleLine = true,
                                visualTransformation = if (showRecConfirm) VisualTransformation.None else PasswordVisualTransformation(),
                                trailingIcon = {
                                    IconButton(onClick = { showRecConfirm = !showRecConfirm }) {
                                        Icon(
                                            imageVector = if (showRecConfirm) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                            contentDescription = if (showRecConfirm) "Hide password" else "Show password"
                                        )
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            )

                            Spacer(Modifier.height(14.dp))
                            Button(
                                onClick = {
                                    scope.launch {
                                        recBusy = true
                                        recError = ""
                                        val res = onCompleteRecovery(recUser, recCode, recNewPass, recConfirmPass)
                                        recBusy = false
                                        res.fold(
                                            onSuccess = {
                                                username = recUser.trim().lowercase()
                                                password = ""
                                                mode = AuthScreenMode.SIGN_IN
                                            },
                                            onFailure = { recError = it.message ?: "Password reset failed." }
                                        )
                                    }
                                },
                                enabled = !recBusy,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(48.dp)
                            ) {
                                if (recBusy) {
                                    CircularProgressIndicator(strokeWidth = 2.dp, color = Color.White)
                                } else {
                                    Text("Reset Admin Password")
                                }
                            }
                        }

                        Spacer(Modifier.height(8.dp))
                        TextButton(
                            onClick = { mode = AuthScreenMode.SIGN_IN },
                            modifier = Modifier.align(Alignment.Start)
                        ) {
                            Icon(Icons.Default.ArrowBack, contentDescription = null)
                            Spacer(Modifier.padding(3.dp))
                            Text("Back to Sign In")
                        }
                    }
                }
            }
        }
    }

    if (showBackendDialog) {
        var urlDraft by remember(state.appsScriptUrl) { mutableStateOf(state.appsScriptUrl) }
        AlertDialog(
            onDismissRequest = { showBackendDialog = false },
            title = { Text("Apps Script Backend URL") },
            text = {
                Column {
                    Text(
                        "Paste the deployed Google Apps Script Web App URL (https://script.google.com/macros/s/.../exec).",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = urlDraft,
                        onValueChange = { urlDraft = it },
                        label = { Text("Web App URL") },
                        singleLine = false,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(onClick = {
                    onSaveBackendUrl(urlDraft)
                    showBackendDialog = false
                }) { Text("Save") }
            },
            dismissButton = {
                TextButton(onClick = { showBackendDialog = false }) { Text("Cancel") }
            }
        )
    }
}

@Composable
fun BiometricUnlockGateScreen(
    user: AuthUser,
    onRequestBiometric: () -> Unit,
    onUsePasswordInstead: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SlateSurface)
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color.White)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(
                    imageVector = Icons.Default.Fingerprint,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    text = "Welcome back, ${user.name}",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "${user.username} (${user.role.replaceFirstChar { it.uppercase() }})",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF64748B)
                )
                Spacer(Modifier.height(16.dp))
                Text(
                    text = "Unlock with your phone's fingerprint or screen lock to continue.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(Modifier.height(20.dp))
                Button(
                    onClick = onRequestBiometric,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                ) {
                    Icon(Icons.Default.Fingerprint, contentDescription = null)
                    Spacer(Modifier.padding(4.dp))
                    Text("Unlock with Fingerprint / Screen Lock")
                }
                Spacer(Modifier.height(10.dp))
                TextButton(onClick = onUsePasswordInstead) {
                    Text("Sign in with App Password Instead")
                }
            }
        }
    }
}
