package com.sunviloz.cleancare.ui.screens

import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.sunviloz.cleancare.data.model.MoneyReceiptRecord
import com.sunviloz.cleancare.data.model.OrderRecord
import com.sunviloz.cleancare.data.model.QuotationItem
import com.sunviloz.cleancare.data.model.QuotationRecord
import com.sunviloz.cleancare.data.model.SunvilozConstants
import com.sunviloz.cleancare.data.model.SyncBadgeState
import com.sunviloz.cleancare.ui.AppUiState
import com.sunviloz.cleancare.ui.MainViewModel
import com.sunviloz.cleancare.ui.theme.AmberBg
import com.sunviloz.cleancare.ui.theme.AmberWarning
import com.sunviloz.cleancare.ui.theme.NavyPrimary
import com.sunviloz.cleancare.ui.theme.RedError
import kotlinx.coroutines.launch
import java.util.UUID

@Composable
fun SyncStatusBanner(
    badge: SyncBadgeState,
    pendingCount: Int,
    lastError: String,
    onRetry: () -> Unit
) {
    val (bg, fg, icon, text) = when (badge) {
        SyncBadgeState.SAVED -> Quad(Color(0xFFECFDF5), Color(0xFF065F46), Icons.Default.CloudDone, "Saved to Google Sheets")
        SyncBadgeState.PENDING_SYNC -> Quad(AmberBg, AmberWarning, Icons.Default.CloudSync, "Pending Sync ($pendingCount queued)")
        SyncBadgeState.SYNC_FAILED -> Quad(Color(0xFFFEF2F2), RedError, Icons.Default.CloudOff, "Sync Failed: ${lastError.ifBlank { "Offline" }}")
    }
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = bg)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                Icon(icon, contentDescription = null, tint = fg)
                Spacer(Modifier.padding(4.dp))
                Text(text, style = MaterialTheme.typography.labelMedium, color = fg, fontWeight = FontWeight.SemiBold)
            }
            if (badge != SyncBadgeState.SAVED) {
                TextButton(onClick = onRetry) { Text("Retry") }
            }
        }
    }
}

private data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)

@Composable
fun AdminDashboardScreen(state: AppUiState, onRefresh: () -> Unit) {
    val orders = state.bootstrap.orders
    val today = state.bootstrap.todayDhaka.ifBlank { SunvilozConstants.todayDhakaIso() }
    val todayJobs = orders.count { it.scheduledDate == today && it.status != "Cancelled" }
    val completedJobs = orders.count { it.status == "Completed" && !it.isNoChargeVisit }
    val dueFollowups = orders.count { it.status == "Completed" && !it.followupDone && it.followupDate.isNotBlank() && it.followupDate <= today }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text("Operations Dashboard", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("Business Date (Asia/Dhaka): $today", style = MaterialTheme.typography.bodySmall, color = Color(0xFF64748B))
                }
                IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, contentDescription = "Refresh") }
            }
        }
        item {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MetricTile("Today's Jobs", "$todayJobs", Modifier.weight(1f))
                MetricTile("Completed", "$completedJobs", Modifier.weight(1f))
            }
        }
        item {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MetricTile("Due Follow-Ups", "$dueFollowups", Modifier.weight(1f))
                MetricTile("Monthly Profit", SunvilozConstants.formatBdt(state.monthlyReport.summary.jobProfitLoss), Modifier.weight(1f))
            }
        }
        item {
            Text("Recent Orders", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        items(orders.take(10), key = { it.orderId }) { order ->
            OrderSummaryCard(order = order, onClick = {})
        }
    }
}

@Composable
fun MetricTile(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier, colors = CardDefaults.cardColors(containerColor = Color.White)) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = Color(0xFF64748B))
            Spacer(Modifier.height(4.dp))
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = NavyPrimary)
        }
    }
}

@Composable
fun OrderSummaryCard(order: OrderRecord, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = Color.White)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${order.orderId} · ${order.customerName}", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (order.isStatusLocked) {
                        Icon(Icons.Default.Lock, contentDescription = "Status Locked", tint = Color(0xFF0F766E))
                    }
                    Text(
                        if (order.isStatusLocked) "Completed · Locked" else order.status,
                        style = MaterialTheme.typography.labelMedium,
                        color = if (order.status == "Completed") Color(0xFF0F766E) else NavyPrimary,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(order.serviceType, style = MaterialTheme.typography.bodySmall, color = Color(0xFF334155))
            Text("${order.scheduledDate} ${order.scheduledTime} · ${order.area.ifBlank { order.address }}", style = MaterialTheme.typography.bodySmall, color = Color(0xFF64748B))
            Spacer(Modifier.height(4.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(SunvilozConstants.formatBdt(order.priceBdt), fontWeight = FontWeight.Bold, color = NavyPrimary)
                if (order.assignedSupervisorName.isNotBlank()) {
                    Text("Sup: ${order.assignedSupervisorName}", style = MaterialTheme.typography.labelSmall, color = Color(0xFF475569))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminOrdersScreen(
    state: AppUiState,
    vm: MainViewModel,
    onExportReceiptPdf: (MoneyReceiptRecord) -> Unit
) {
    var selectedOrder by remember { mutableStateOf<OrderRecord?>(null) }
    var showNewOrderDialog by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().padding(14.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Orders (${state.bootstrap.orders.size})", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Button(onClick = { showNewOrderDialog = true }) {
                Icon(Icons.Default.Add, contentDescription = null)
                Spacer(Modifier.padding(2.dp))
                Text("New Order")
            }
        }
        Spacer(Modifier.height(10.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(state.bootstrap.orders, key = { it.orderId }) { order ->
                OrderSummaryCard(order = order, onClick = { selectedOrder = order })
            }
        }
    }

    selectedOrder?.let { ord ->
        OrderDetailDialog(
            order = ord,
            vm = vm,
            receipts = state.bootstrap.receipts.filter { it.orderId == ord.orderId },
            onDismiss = { selectedOrder = null },
            onExportReceiptPdf = onExportReceiptPdf
        )
    }

    if (showNewOrderDialog) {
        NewOrderDialog(
            state = state,
            vm = vm,
            onDismiss = { showNewOrderDialog = false }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NewOrderDialog(state: AppUiState, vm: MainViewModel, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val requestId = remember { "ord-${UUID.randomUUID()}" }
    var customerName by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var area by remember { mutableStateOf("") }
    var selectedService by remember { mutableStateOf(SunvilozConstants.DEFAULT_SERVICES.first()) }
    var serviceMenuOpen by remember { mutableStateOf(false) }
    var priceText by remember { mutableStateOf("") }
    var scheduledDate by remember { mutableStateOf(SunvilozConstants.todayDhakaIso()) }
    var scheduledTime by remember { mutableStateOf("10:00") }
    var supervisorId by remember { mutableStateOf(state.bootstrap.supervisors.firstOrNull()?.id.orEmpty()) }
    var supMenuOpen by remember { mutableStateOf(false) }
    var advanceText by remember { mutableStateOf("0") }
    var notes by remember { mutableStateOf("") }
    var saveError by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    val selectedSupLabel = state.bootstrap.supervisors.firstOrNull { it.id == supervisorId }?.name
        ?: "Unassigned"

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create New Order") },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (saveError.isNotBlank()) {
                    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFEF2F2))) {
                        Text(saveError, color = RedError, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(10.dp))
                    }
                }
                OutlinedTextField(customerName, { customerName = it }, label = { Text("Customer Name *") }, singleLine = true)
                OutlinedTextField(phone, { phone = it }, label = { Text("Phone *") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
                OutlinedTextField(address, { address = it }, label = { Text("Address *") })
                OutlinedTextField(area, { area = it }, label = { Text("Area (e.g. Uttara, Dhanmondi)") }, singleLine = true)

                ExposedDropdownMenuBox(expanded = serviceMenuOpen, onExpandedChange = { serviceMenuOpen = it }) {
                    OutlinedTextField(
                        value = selectedService,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Service *") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = serviceMenuOpen) },
                        modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth()
                    )
                    ExposedDropdownMenu(expanded = serviceMenuOpen, onDismissRequest = { serviceMenuOpen = false }) {
                        SunvilozConstants.DEFAULT_SERVICES.forEach { svc ->
                            DropdownMenuItem(
                                text = { Text(svc) },
                                onClick = {
                                    selectedService = svc
                                    serviceMenuOpen = false
                                }
                            )
                        }
                    }
                }
                SunvilozConstants.PACKAGE_INCLUSIONS[selectedService]?.let { hint ->
                    Text(hint, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                }

                ExposedDropdownMenuBox(expanded = supMenuOpen, onExpandedChange = { supMenuOpen = it }) {
                    OutlinedTextField(
                        value = selectedSupLabel,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Assigned Supervisor") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = supMenuOpen) },
                        modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth()
                    )
                    ExposedDropdownMenu(expanded = supMenuOpen, onDismissRequest = { supMenuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text("Unassigned") },
                            onClick = {
                                supervisorId = ""
                                supMenuOpen = false
                            }
                        )
                        state.bootstrap.supervisors.filter { it.isActive }.forEach { sup ->
                            DropdownMenuItem(
                                text = { Text("${sup.name} (@${sup.username})") },
                                onClick = {
                                    supervisorId = sup.id
                                    supMenuOpen = false
                                }
                            )
                        }
                    }
                }

                OutlinedTextField(priceText, { priceText = it }, label = { Text("Agreed Price (BDT) *") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                OutlinedTextField(scheduledDate, { scheduledDate = it }, label = { Text("Scheduled Work Date (YYYY-MM-DD)") }, singleLine = true)
                OutlinedTextField(scheduledTime, { scheduledTime = it }, label = { Text("Scheduled Time (HH:mm)") }, singleLine = true)
                OutlinedTextField(advanceText, { advanceText = it }, label = { Text("Advance Given to Supervisor (BDT)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                OutlinedTextField(notes, { notes = it }, label = { Text("Notes") })
            }
        },
        confirmButton = {
            Button(
                enabled = !saving,
                onClick = {
                    scope.launch {
                        saving = true
                        saveError = ""
                        val res = vm.createOrder(
                            customerName = customerName,
                            phone = phone,
                            address = address,
                            area = area,
                            serviceType = selectedService,
                            priceBdt = priceText.toDoubleOrNull() ?: 0.0,
                            bookingDate = SunvilozConstants.todayDhakaIso(),
                            scheduledDate = scheduledDate,
                            scheduledTime = scheduledTime,
                            supervisorId = supervisorId,
                            advanceGiven = advanceText.toDoubleOrNull() ?: 0.0,
                            notes = notes,
                            requestId = requestId
                        )
                        saving = false
                        if (res.isSuccess) {
                            onDismiss()
                        } else {
                            // Keep form OPEN on failure with Retry option!
                            saveError = res.exceptionOrNull()?.message ?: "Not Saved. Tap Save / Retry."
                        }
                    }
                }
            ) {
                Text(if (saveError.isNotBlank()) "Retry Save" else "Save Order")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } }
    )
}

@Composable
private fun OrderDetailDialog(
    order: OrderRecord,
    vm: MainViewModel,
    receipts: List<MoneyReceiptRecord>,
    onDismiss: () -> Unit,
    onExportReceiptPdf: (MoneyReceiptRecord) -> Unit
) {
    val scope = rememberCoroutineScope()
    val completeReqId = remember { "cmp-${UUID.randomUUID()}" }
    var transportText by remember { mutableStateOf("0") }
    var mealsText by remember { mutableStateOf("0") }
    var fullBillChecked by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("${order.orderId} · ${order.customerName}") },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Service: ${order.serviceType}", fontWeight = FontWeight.SemiBold)
                Text("Bill: ${SunvilozConstants.formatBdt(order.priceBdt)} · Scheduled: ${order.scheduledDate}")
                Text("Status: ${if (order.isStatusLocked) "Completed (Status Locked)" else order.status}", color = if (order.isStatusLocked) Color(0xFF0F766E) else NavyPrimary, fontWeight = FontWeight.Bold)
                if (order.isStatusLocked) {
                    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFECFDF5))) {
                        Text(
                            "Order status is permanently locked because this order is Completed and full customer payment is confirmed. Money Receipts, Settlements, and Follow-Ups remain available.",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFF065F46),
                            modifier = Modifier.padding(10.dp)
                        )
                    }
                }
                if (order.returnVisitCostsTotal > 0) {
                    Text("Linked Return-Visit Costs: ${SunvilozConstants.formatBdt(order.returnVisitCostsTotal)}")
                    Text("Lifetime Job Profit: ${SunvilozConstants.formatBdt(order.lifetimeJobProfit)}", fontWeight = FontWeight.Bold)
                }

                if (actionError.isNotBlank()) {
                    Text(actionError, color = RedError, style = MaterialTheme.typography.bodySmall)
                }

                if (!order.isStatusLocked && order.status != "Completed") {
                    HorizontalDivider()
                    Text("Complete Order & Confirm Full Bill", fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(transportText, { transportText = it }, label = { Text("Transport Cost (BDT)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                    OutlinedTextField(mealsText, { mealsText = it }, label = { Text("Meals Cost (BDT)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = fullBillChecked, onCheckedChange = { fullBillChecked = it })
                        Text("Full job bill collected (${SunvilozConstants.formatBdt(order.priceBdt)})", style = MaterialTheme.typography.bodySmall)
                    }
                    Button(
                        onClick = {
                            scope.launch {
                                actionError = ""
                                val res = vm.completeOrder(
                                    orderId = order.orderId,
                                    transportCost = transportText.toDoubleOrNull() ?: 0.0,
                                    mealsCost = mealsText.toDoubleOrNull() ?: 0.0,
                                    otherExpenses = emptyList(),
                                    fullBillCollected = fullBillChecked,
                                    requestId = completeReqId
                                )
                                if (res.isSuccess) onDismiss() else actionError = res.exceptionOrNull()?.message.orEmpty()
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.CheckCircle, contentDescription = null)
                        Spacer(Modifier.padding(3.dp))
                        Text("Mark Completed & Lock Status")
                    }
                }

                // Money Receipt always remains available even after Status Lock
                HorizontalDivider()
                Text("Money Receipts", fontWeight = FontWeight.SemiBold)
                receipts.forEach { rec ->
                    OutlinedButton(onClick = { onExportReceiptPdf(rec) }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.Description, contentDescription = null)
                        Spacer(Modifier.padding(3.dp))
                        Text("Download PDF: ${rec.receiptNumber}")
                    }
                }
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            val res = vm.issueMoneyReceipt(order.orderId, "Cash")
                            if (res.isFailure) actionError = res.exceptionOrNull()?.message.orEmpty()
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Issue New Money Receipt")
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminQuotationsScreen(
    state: AppUiState,
    vm: MainViewModel,
    onExportQuotationPdf: (QuotationRecord) -> Unit
) {
    val scope = rememberCoroutineScope()
    var showCreate by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().padding(14.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Quotations (${state.bootstrap.quotations.size})", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Button(onClick = { showCreate = true }) {
                Icon(Icons.Default.Add, contentDescription = null)
                Text("New Quotation")
            }
        }
        Spacer(Modifier.height(10.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(state.bootstrap.quotations, key = { it.quotationId }) { q ->
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Text("${q.quotationNumber} · ${q.customerName}", fontWeight = FontWeight.Bold)
                        Text("${q.phoneDisplay} · ${q.area}", style = MaterialTheme.typography.bodySmall, color = Color(0xFF64748B))
                        Text("Total: ${SunvilozConstants.formatBdt(q.totalBdt)} · Status: ${q.status}", fontWeight = FontWeight.SemiBold, color = NavyPrimary)
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { onExportQuotationPdf(q) }) { Text("PDF") }
                            if (q.convertedOrderId.isBlank()) {
                                Button(onClick = {
                                    scope.launch {
                                        vm.convertQuotationToOrder(q.quotationId, SunvilozConstants.todayDhakaIso())
                                    }
                                }) { Text("Convert to Order") }
                            } else {
                                AssistChip(onClick = {}, label = { Text("Order: ${q.convertedOrderId}") })
                            }
                        }
                    }
                }
            }
        }
    }

    if (showCreate) {
        val reqId = remember { "qtn-${UUID.randomUUID()}" }
        var customerName by remember { mutableStateOf("") }
        var phone by remember { mutableStateOf("") }
        var address by remember { mutableStateOf("") }
        var area by remember { mutableStateOf("") }
        val rows = remember { mutableStateListOf(QuotationItem(SunvilozConstants.DEFAULT_SERVICES.first(), "", 0.0)) }
        var err by remember { mutableStateOf("") }

        AlertDialog(
            onDismissRequest = { showCreate = false },
            title = { Text("Create Quotation") },
            text = {
                Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (err.isNotBlank()) Text(err, color = RedError, style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(customerName, { customerName = it }, label = { Text("Customer Name *") }, singleLine = true)
                    OutlinedTextField(phone, { phone = it }, label = { Text("Phone *") }, singleLine = true)
                    OutlinedTextField(address, { address = it }, label = { Text("Address") })
                    OutlinedTextField(area, { area = it }, label = { Text("Area") }, singleLine = true)
                    HorizontalDivider()
                    Text("Services (No auto-added component rows)", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
                    rows.forEachIndexed { idx, row ->
                        var expanded by remember { mutableStateOf(false) }
                        ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
                            OutlinedTextField(
                                value = row.serviceType,
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("Service #${idx + 1}") },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                                modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth()
                            )
                            ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                                SunvilozConstants.DEFAULT_SERVICES.forEach { svc ->
                                    DropdownMenuItem(text = { Text(svc) }, onClick = {
                                        rows[idx] = row.copy(serviceType = svc)
                                        expanded = false
                                    })
                                }
                            }
                        }
                        OutlinedTextField(
                            value = if (row.amountBdt == 0.0) "" else row.amountBdt.toInt().toString(),
                            onValueChange = { rows[idx] = row.copy(amountBdt = it.toDoubleOrNull() ?: 0.0) },
                            label = { Text("Price (BDT)") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            singleLine = true
                        )
                    }
                    OutlinedButton(onClick = { rows.add(QuotationItem(SunvilozConstants.DEFAULT_SERVICES.first(), "", 0.0)) }) {
                        Icon(Icons.Default.Add, contentDescription = null)
                        Text("Add Service")
                    }
                }
            },
            confirmButton = {
                Button(onClick = {
                    scope.launch {
                        val res = vm.saveQuotation(customerName, phone, address, area, rows.toList(), 0.0, "", reqId)
                        if (res.isSuccess) showCreate = false else err = res.exceptionOrNull()?.message.orEmpty()
                    }
                }) { Text("Save Quotation") }
            },
            dismissButton = { TextButton(onClick = { showCreate = false }) { Text("Cancel") } }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminReportsScreen(
    state: AppUiState,
    vm: MainViewModel,
    onExportExcel: () -> Unit
) {
    val report = state.monthlyReport
    val s = report.summary
    val today = state.bootstrap.todayDhaka.ifBlank { SunvilozConstants.todayDhakaIso() }
    var selectedYear by remember(report.year) { mutableStateOf(if (report.year > 2000) report.year else today.substring(0, 4).toInt()) }
    var selectedMonth by remember(report.month) { mutableStateOf(if (report.month in 1..12) report.month else today.substring(5, 7).toInt()) }
    var areaFilter by remember { mutableStateOf("") }
    var serviceFilter by remember { mutableStateOf("") }
    var supervisorFilter by remember { mutableStateOf("") }
    var serviceMenuOpen by remember { mutableStateOf(false) }

    fun reload(y: Int, m: Int, area: String = areaFilter, svc: String = serviceFilter, sup: String = supervisorFilter) {
        selectedYear = y
        selectedMonth = m
        vm.loadMonthlyReport(y, m, area.trim(), svc, sup)
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column {
                    Text("Monthly Jobs & Income", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("Period: ${report.period.ifBlank { "$selectedYear-${selectedMonth.toString().padStart(2, '0')}" }} (Asia/Dhaka · BDT)", style = MaterialTheme.typography.bodySmall, color = Color(0xFF64748B))
                }
                Button(onClick = onExportExcel) { Text("Export XLSX") }
            }
        }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        IconButton(onClick = {
                            val nextM = if (selectedMonth == 1) 12 else selectedMonth - 1
                            val nextY = if (selectedMonth == 1) selectedYear - 1 else selectedYear
                            reload(nextY, nextM)
                        }) { Icon(Icons.Default.ChevronLeft, contentDescription = "Previous month") }
                        Text(
                            text = "${selectedYear}-${selectedMonth.toString().padStart(2, '0')}",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = NavyPrimary
                        )
                        IconButton(onClick = {
                            val nextM = if (selectedMonth == 12) 1 else selectedMonth + 1
                            val nextY = if (selectedMonth == 12) selectedYear + 1 else selectedYear
                            reload(nextY, nextM)
                        }) { Icon(Icons.Default.ChevronRight, contentDescription = "Next month") }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = areaFilter,
                            onValueChange = { areaFilter = it },
                            label = { Text("Area Filter") },
                            singleLine = true,
                            modifier = Modifier.weight(1f)
                        )
                        ExposedDropdownMenuBox(
                            expanded = serviceMenuOpen,
                            onExpandedChange = { serviceMenuOpen = it },
                            modifier = Modifier.weight(1f)
                        ) {
                            OutlinedTextField(
                                value = serviceFilter.ifBlank { "All Services" },
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("Service") },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = serviceMenuOpen) },
                                modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth()
                            )
                            ExposedDropdownMenu(expanded = serviceMenuOpen, onDismissRequest = { serviceMenuOpen = false }) {
                                DropdownMenuItem(text = { Text("All Services") }, onClick = { serviceFilter = ""; serviceMenuOpen = false })
                                SunvilozConstants.DEFAULT_SERVICES.forEach { svc ->
                                    DropdownMenuItem(text = { Text(svc) }, onClick = { serviceFilter = svc; serviceMenuOpen = false })
                                }
                            }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { reload(selectedYear, selectedMonth) }) { Text("Apply Filters") }
                        if (areaFilter.isNotBlank() || serviceFilter.isNotBlank() || supervisorFilter.isNotBlank()) {
                            OutlinedButton(onClick = {
                                areaFilter = ""
                                serviceFilter = ""
                                supervisorFilter = ""
                                reload(selectedYear, selectedMonth, "", "", "")
                            }) { Text("Clear") }
                        }
                    }
                }
            }
        }
        item {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MetricTile("Completed Jobs", "${s.completedJobs}", Modifier.weight(1f))
                MetricTile("No-Charge Visits", "${s.noChargeReturnVisits}", Modifier.weight(1f))
            }
        }
        item {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MetricTile("Income Collected", SunvilozConstants.formatBdt(s.incomeCollected), Modifier.weight(1f))
                MetricTile("Completed Bills", SunvilozConstants.formatBdt(s.completedJobBills), Modifier.weight(1f))
            }
        }
        item {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MetricTile("Actual Job Costs", SunvilozConstants.formatBdt(s.actualJobCosts), Modifier.weight(1f))
                MetricTile("Job Profit / Loss", SunvilozConstants.formatBdt(s.jobProfitLoss), Modifier.weight(1f))
            }
        }
        item {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MetricTile(
                    if (report.filtersApplied) "Company General Expenses" else "General Business Expenses",
                    SunvilozConstants.formatBdt(s.generalBusinessExpenses),
                    Modifier.weight(1f)
                )
                MetricTile(
                    "Net Business Profit",
                    s.netBusinessProfit?.let { SunvilozConstants.formatBdt(it) } ?: "Unfiltered Only",
                    Modifier.weight(1f)
                )
            }
        }
        item {
            Text("Supporting Job Records (${report.rows.size})", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        items(report.rows, key = { it.orderId }) { row ->
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text("${row.orderId} · ${row.customerName}", fontWeight = FontWeight.Bold)
                    Text("${row.completionDate} · ${row.serviceType}", style = MaterialTheme.typography.bodySmall)
                    Text("Bill: ${SunvilozConstants.formatBdt(row.billBdt)} | Cost: ${SunvilozConstants.formatBdt(row.actualJobCost)} | Profit: ${SunvilozConstants.formatBdt(row.jobProfit)}", style = MaterialTheme.typography.labelMedium, color = NavyPrimary)
                }
            }
        }
    }
}
