package com.sunviloz.cleancare.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Backup
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import com.sunviloz.cleancare.data.model.SunvilozConstants
import com.sunviloz.cleancare.data.model.SupervisorJobView
import com.sunviloz.cleancare.ui.AppUiState
import com.sunviloz.cleancare.ui.MainViewModel
import com.sunviloz.cleancare.ui.theme.NavyPrimary
import com.sunviloz.cleancare.ui.theme.RedError
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Admin-only Settings → Account & Security, Supervisors, and Backup & Restore.
 */
@Composable
fun AdminSettingsAndBackupScreen(
    currentUser: AuthUser,
    state: AppUiState,
    vm: MainViewModel,
    onAuthorizeSecondaryGoogle: () -> Unit,
    onPickLocalBackupFile: () -> Unit,
    onSignOut: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val settings = state.bootstrap.settings

    // Admin Account & Security form (prefilled with saved admin username)
    var curPass by remember { mutableStateOf("") }
    var newAdminUser by remember(currentUser.username) { mutableStateOf(currentUser.username) }
    var newAdminPass by remember { mutableStateOf("") }
    var confirmAdminPass by remember { mutableStateOf("") }
    var showCurPass by remember { mutableStateOf(false) }
    var showNewPass by remember { mutableStateOf(false) }
    var showConfirmPass by remember { mutableStateOf(false) }
    var credBusy by remember { mutableStateOf(false) }
    var credError by remember { mutableStateOf("") }

    // Supervisor creation dialog
    var showSupDialog by remember { mutableStateOf(false) }

    // Daily scheduled secondary bridge form
    var bridgeUrl by remember { mutableStateOf("") }
    var bridgeSecret by remember { mutableStateOf("") }
    var autoEnabled by remember(settings.autoBackupEnabled) { mutableStateOf(settings.autoBackupEnabled) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("Settings & Backup", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)

        // 1. Secondary Google Drive Backup & Restore (Admin-only)
        Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Secondary Google Drive Backup & Restore", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = NavyPrimary)
                Text("Primary Google Account (Database): ${settings.primaryOwnerGoogleEmail.ifBlank { "Configured in Apps Script" }}", style = MaterialTheme.typography.bodySmall)
                Text(
                    "Secondary Backup Account: ${state.secondaryVerifiedEmail.ifBlank { settings.secondaryDriveEmail.ifBlank { "Not Connected" } }}",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
                Text("Last Verified Backup: ${settings.lastVerifiedBackupAt.ifBlank { "None yet" }} ${if (settings.lastVerifiedBackupFile.isNotBlank()) "(${settings.lastVerifiedBackupFile})" else ""}", style = MaterialTheme.typography.labelSmall)
                if (settings.lastBackupError.isNotBlank()) {
                    Text("Last Backup Error: ${settings.lastBackupError}", color = RedError, style = MaterialTheme.typography.labelSmall)
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onAuthorizeSecondaryGoogle, enabled = !state.backupBusy) {
                        Text("Authorize Second Google Account")
                    }
                    Button(
                        onClick = { vm.runBackUpNow() },
                        enabled = !state.backupBusy && state.secondaryAccessToken.isNotBlank()
                    ) {
                        Icon(Icons.Default.Backup, contentDescription = null)
                        Spacer(Modifier.padding(3.dp))
                        Text("Back Up Now")
                    }
                }

                HorizontalDivider()
                Text("Daily Unattended Scheduled Backup (Runs While Phone Is Closed)", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                OutlinedTextField(bridgeUrl, { bridgeUrl = it }, label = { Text("Secondary Apps Script Bridge URL") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(bridgeSecret, { bridgeSecret = it }, label = { Text("Bridge Secret (stored only in Apps Script)") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Text("Enable Daily 2:00 AM Asia/Dhaka Backup", style = MaterialTheme.typography.bodySmall)
                    Switch(checked = autoEnabled, onCheckedChange = { autoEnabled = it })
                }
                OutlinedButton(onClick = { vm.saveSecondaryScheduledBridge(bridgeUrl, bridgeSecret, autoEnabled) }) {
                    Text("Save Daily Schedule Settings")
                }

                HorizontalDivider()
                Text("Restore from Dated Secondary Drive Version or Local File", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                OutlinedButton(onClick = onPickLocalBackupFile, enabled = !state.backupBusy) {
                    Icon(Icons.Default.Restore, contentDescription = null)
                    Spacer(Modifier.padding(3.dp))
                    Text("Restore from Downloaded Backup File (.json)")
                }
                state.secondaryVersions.take(6).forEach { ver ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(ver.fileName, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                            Text("${ver.createdTime} · ${ver.sizeBytes / 1024} KB", style = MaterialTheme.typography.labelSmall, color = Color(0xFF64748B))
                        }
                        TextButton(onClick = { vm.previewRestoreFromSecondaryFile(ver.fileId) }) {
                            Text("Preview & Restore")
                        }
                    }
                }
            }
        }

        // 2. Supervisors Management
        Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("Supervisor Accounts (${state.bootstrap.supervisors.size})", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    OutlinedButton(onClick = { showSupDialog = true }) {
                        Icon(Icons.Default.PersonAdd, contentDescription = null)
                        Spacer(Modifier.padding(2.dp))
                        Text("Add")
                    }
                }
                state.bootstrap.supervisors.forEach { sup ->
                    Text("${sup.name} (@${sup.username}) · ${if (sup.isActive) "Active" else "Inactive"}", style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        // 3. Account & Security
        Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Account & Security", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = NavyPrimary)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Text("Unlock with Fingerprint / Phone Screen Lock", style = MaterialTheme.typography.bodySmall)
                    Switch(checked = state.deviceUnlockEnabled, onCheckedChange = { vm.setDeviceUnlockEnabled(it) })
                }
                HorizontalDivider()
                Text("Admin Username & Password", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    "Enter your Current Password before updating your username, password, or both. Leave New Password blank to keep your existing password. Saving revokes all previous admin sessions.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF64748B)
                )
                if (credError.isNotBlank()) {
                    Text(credError, style = MaterialTheme.typography.bodySmall, color = RedError, fontWeight = FontWeight.Medium)
                }
                OutlinedTextField(
                    value = newAdminUser,
                    onValueChange = { newAdminUser = it },
                    label = { Text("Admin Username *") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = curPass,
                    onValueChange = { curPass = it },
                    label = { Text("Current Password *") },
                    singleLine = true,
                    visualTransformation = if (showCurPass) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { showCurPass = !showCurPass }) {
                            Icon(
                                imageVector = if (showCurPass) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                contentDescription = if (showCurPass) "Hide current password" else "Show current password"
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = newAdminPass,
                    onValueChange = { newAdminPass = it },
                    label = { Text("New Password (optional, leave blank to keep current)") },
                    singleLine = true,
                    visualTransformation = if (showNewPass) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { showNewPass = !showNewPass }) {
                            Icon(
                                imageVector = if (showNewPass) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                contentDescription = if (showNewPass) "Hide new password" else "Show new password"
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                )
                if (newAdminPass.isNotEmpty()) {
                    OutlinedTextField(
                        value = confirmAdminPass,
                        onValueChange = { confirmAdminPass = it },
                        label = { Text("Confirm New Password *") },
                        singleLine = true,
                        visualTransformation = if (showConfirmPass) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { showConfirmPass = !showConfirmPass }) {
                                Icon(
                                    imageVector = if (showConfirmPass) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = if (showConfirmPass) "Hide confirm password" else "Show confirm password"
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                Button(
                    enabled = !credBusy,
                    onClick = {
                        scope.launch {
                            credBusy = true
                            credError = ""
                            val res = vm.updateAdminCredentials(
                                currentPassword = curPass,
                                newUsernameRaw = newAdminUser,
                                newPassword = newAdminPass,
                                confirmNewPassword = confirmAdminPass
                            )
                            credBusy = false
                            res.fold(
                                onSuccess = {
                                    curPass = ""
                                    newAdminPass = ""
                                    confirmAdminPass = ""
                                },
                                onFailure = { credError = it.message ?: "Unable to update admin credentials." }
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { Text(if (credBusy) "Saving..." else "Save Account Changes") }

                HorizontalDivider()
                OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Logout, contentDescription = null)
                    Spacer(Modifier.padding(3.dp))
                    Text("Sign Out")
                }
            }
        }
    }

    // Restore Preview Confirmation Dialog
    state.pendingRestoreSummary?.let { summary ->
        AlertDialog(
            onDismissRequest = { vm.cancelRestorePreview() },
            title = { Text("Confirm Backup Restore") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Backup Integrity: Verified (SHA-256 matched)", fontWeight = FontWeight.Bold, color = Color(0xFF065F46))
                    Text("Created At: ${summary.createdAt}")
                    Text("Orders: ${summary.counts.orders} | Customers: ${summary.counts.customers}")
                    Text("Quotations: ${summary.counts.quotations} | Receipts: ${summary.counts.receipts}")
                    Text("Workers: ${summary.counts.workers} | Users: ${summary.counts.users}")
                    Text("Document Pads: ${summary.counts.documentPads} | Issued PDFs: ${summary.counts.issuedPdfs} | Logo: ${if (summary.counts.hasLogo) "Yes" else "No"}")
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Passwords and secrets were excluded from the backup. Restored supervisors will be relinked by ID (preserving all job assignments) and require a fresh password reset before signing in.",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            },
            confirmButton = {
                Button(onClick = { vm.confirmRestoreBackup() }) { Text("Confirm Restore") }
            },
            dismissButton = {
                TextButton(onClick = { vm.cancelRestorePreview() }) { Text("Cancel") }
            }
        )
    }

    if (showSupDialog) {
        var sName by remember { mutableStateOf("") }
        var sUser by remember { mutableStateOf("") }
        var sPhone by remember { mutableStateOf("") }
        var sPass by remember { mutableStateOf("") }
        var sErr by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showSupDialog = false },
            title = { Text("Create Supervisor Login Account") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (sErr.isNotBlank()) Text(sErr, color = RedError, style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(sName, { sName = it }, label = { Text("Full Name *") }, singleLine = true)
                    OutlinedTextField(sUser, { sUser = it }, label = { Text("Username *") }, singleLine = true)
                    OutlinedTextField(sPhone, { sPhone = it }, label = { Text("Phone") }, singleLine = true)
                    OutlinedTextField(sPass, { sPass = it }, label = { Text("Initial Password (min 6) *") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
                }
            },
            confirmButton = {
                Button(onClick = {
                    scope.launch {
                        val res = vm.createSupervisor(sName, sUser, sPhone, sPass)
                        if (res.isSuccess) showSupDialog = false else sErr = res.exceptionOrNull()?.message.orEmpty()
                    }
                }) { Text("Create Account") }
            },
            dismissButton = { TextButton(onClick = { showSupDialog = false }) { Text("Cancel") } }
        )
    }
}

/**
 * Restricted Field Supervisor Screen:
 * - Shows ONLY the supervisor's own assigned jobs from today through today + 6 days.
 * - Zero access to Admin settings, Reports, Google Drive, or underlying Sheet.
 */
@Composable
fun SupervisorHomeScreen(
    state: AppUiState,
    vm: MainViewModel,
    onSignOut: () -> Unit
) {
    val jobsPayload = state.supervisorJobs
    var completingJob by remember { mutableStateOf<SupervisorJobView?>(null) }

    Column(modifier = Modifier.fillMaxSize().padding(14.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text("My Assigned Jobs", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("Window: ${jobsPayload.todayDhaka} to ${jobsPayload.endDateDhaka}", style = MaterialTheme.typography.bodySmall, color = Color(0xFF64748B))
            }
            Row {
                IconButton(onClick = {
                    val user = (state.authState as? com.sunviloz.cleancare.ui.AuthGateState.Authenticated)?.user
                    if (user != null) vm.loadWorkspaceForUser(user)
                }) { Icon(Icons.Default.Refresh, contentDescription = "Refresh") }
                IconButton(onClick = onSignOut) { Icon(Icons.Default.Logout, contentDescription = "Sign Out") }
            }
        }
        Spacer(Modifier.height(10.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(jobsPayload.jobs, key = { it.orderId }) { job ->
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("${job.orderId} · ${job.customerName}", fontWeight = FontWeight.Bold)
                            Text(
                                if (job.isStatusLocked) "Completed · Locked" else job.status,
                                color = if (job.status == "Completed") Color(0xFF0F766E) else NavyPrimary,
                                fontWeight = FontWeight.SemiBold,
                                style = MaterialTheme.typography.labelMedium
                            )
                        }
                        Text(job.serviceType, style = MaterialTheme.typography.bodySmall)
                        Text("${job.scheduledDate} ${job.scheduledTime} · ${job.address}", style = MaterialTheme.typography.bodySmall, color = Color(0xFF475569))
                        Text("Phone: ${job.phoneDisplay} · Bill: ${SunvilozConstants.formatBdt(job.priceBdt)}", style = MaterialTheme.typography.labelMedium)
                        job.buildingInfo?.let { b ->
                            Text("Building: ${b.name} · OH Tanks: ${b.overheadTankCount} · Reserve: ${b.reserveTankCount}", style = MaterialTheme.typography.labelSmall, color = Color(0xFF64748B))
                        }
                        if (!job.isStatusLocked && job.status != "Completed") {
                            Spacer(Modifier.height(6.dp))
                            Button(onClick = { completingJob = job }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Default.CheckCircle, contentDescription = null)
                                Spacer(Modifier.padding(3.dp))
                                Text("Submit Completion Form")
                            }
                        } else if (job.isStatusLocked) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Icon(Icons.Default.Lock, contentDescription = null, tint = Color(0xFF0F766E))
                                Text("Status Locked (Completed & Paid)", style = MaterialTheme.typography.labelSmall, color = Color(0xFF065F46))
                            }
                        }
                    }
                }
            }
        }
    }

    completingJob?.let { job ->
        val scope = rememberCoroutineScope()
        val reqId = remember { "supcmp-${UUID.randomUUID()}" }
        var transport by remember { mutableStateOf("0") }
        var meals by remember { mutableStateOf("0") }
        var fullBill by remember { mutableStateOf(false) }
        var err by remember { mutableStateOf("") }

        AlertDialog(
            onDismissRequest = { completingJob = null },
            title = { Text("Complete ${job.orderId}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (err.isNotBlank()) Text(err, color = RedError, style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(transport, { transport = it }, label = { Text("Transport Cost (BDT)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                    OutlinedTextField(meals, { meals = it }, label = { Text("Meals Cost (BDT)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = fullBill, onCheckedChange = { fullBill = it })
                        Text("Full bill collected (${SunvilozConstants.formatBdt(job.priceBdt)})", style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                Button(onClick = {
                    scope.launch {
                        err = ""
                        val res = vm.completeOrder(
                            orderId = job.orderId,
                            transportCost = transport.toDoubleOrNull() ?: 0.0,
                            mealsCost = meals.toDoubleOrNull() ?: 0.0,
                            otherExpenses = emptyList(),
                            fullBillCollected = fullBill,
                            requestId = reqId
                        )
                        if (res.isSuccess) completingJob = null else err = res.exceptionOrNull()?.message.orEmpty()
                    }
                }) { Text(if (err.isNotBlank()) "Retry Submit" else "Submit Completion") }
            },
            dismissButton = { TextButton(onClick = { completingJob = null }) { Text("Close") } }
        )
    }
}
