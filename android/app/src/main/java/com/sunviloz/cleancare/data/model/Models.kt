package com.sunviloz.cleancare.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.text.NumberFormat
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

object SunvilozConstants {
    val DHAKA_ZONE: ZoneId = ZoneId.of("Asia/Dhaka")
    val ISO_DATE_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")

    // Exact 5 service options in exact required order
    val DEFAULT_SERVICES: List<String> = listOf(
        "Overhead Tank Cleaning",
        "Reserve Tank Cleaning",
        "Overhead & Reserve Tank Cleaning",
        "Pipeline Cleaning",
        "Full Package"
    )

    val PACKAGE_INCLUSIONS: Map<String, String> = mapOf(
        "Overhead & Reserve Tank Cleaning" to "Includes Overhead Tank Cleaning and Reserve Tank Cleaning",
        "Full Package" to "Includes Overhead Tank Cleaning, Reserve Tank Cleaning, and Pipeline Cleaning"
    )

    fun todayDhakaIso(): String = ZonedDateTime.now(DHAKA_ZONE).format(ISO_DATE_FMT)

    fun formatBdt(amount: Double): String {
        val nf = NumberFormat.getNumberInstance(Locale.US).apply {
            maximumFractionDigits = 0
            minimumFractionDigits = 0
        }
        return "BDT ${nf.format(amount)}"
    }
}

enum class SyncBadgeState {
    SAVED,
    PENDING_SYNC,
    SYNC_FAILED
}

@Serializable
data class AuthUser(
    val id: String = "",
    val role: String = "supervisor",
    val name: String = "",
    val username: String = "",
    @SerialName("phone_display") val phoneDisplay: String = "",
    @SerialName("is_active") val isActive: Boolean = true
) {
    val isAdmin: Boolean get() = role == "admin"
}

@Serializable
data class AuthStatusResponse(
    val backendReady: Boolean = false,
    val needsInitialAdminSetup: Boolean = false,
    val adminConfigured: Boolean = false,
    val initialAdminUsername: String = "scc@gmail.com",
    val recoveryRecipientEmail: String = "sunvilozltd@gmail.com",
    val companyLogoDataUrl: String = ""
)

@Serializable
data class AuthActionMessageResponse(
    val sent: Boolean = false,
    val verified: Boolean = false,
    val initialized: Boolean = false,
    val recovered: Boolean = false,
    val requiresSignIn: Boolean = false,
    val username: String = "",
    val message: String = ""
)

@Serializable
data class LoginResponse(
    val token: String = "",
    val user: AuthUser = AuthUser(),
    val deviceId: String = "",
    val message: String = ""
)

@Serializable
data class OtherExpenseItem(
    val description: String = "",
    val amount: Double = 0.0
)

@Serializable
data class OrderWorkerAssignment(
    @SerialName("assignment_id") val assignmentId: String = "",
    @SerialName("order_id") val orderId: String = "",
    @SerialName("worker_id") val workerId: String = "",
    @SerialName("worker_name") val workerName: String = "",
    @SerialName("wage_bdt") val wageBdt: Double = 0.0,
    val confirmed: Boolean = false,
    val paid: Boolean = false,
    @SerialName("paid_at") val paidAt: String = ""
)

@Serializable
data class OrderRecord(
    @SerialName("order_id") val orderId: String = "",
    @SerialName("booking_date") val bookingDate: String = "",
    @SerialName("customer_id") val customerId: String = "",
    @SerialName("building_id") val buildingId: String = "",
    @SerialName("customer_name") val customerName: String = "",
    @SerialName("phone_display") val phoneDisplay: String = "",
    val address: String = "",
    val area: String = "",
    @SerialName("service_type") val serviceType: String = "",
    @SerialName("price_bdt") val priceBdt: Double = 0.0,
    @SerialName("scheduled_date") val scheduledDate: String = "",
    @SerialName("scheduled_time") val scheduledTime: String = "",
    val status: String = "Confirmed",
    @SerialName("status_locked") val statusLocked: Boolean = false,
    @SerialName("status_locked_at") val statusLockedAt: String = "",
    @SerialName("assigned_supervisor_id") val assignedSupervisorId: String = "",
    @SerialName("assigned_supervisor_name") val assignedSupervisorName: String = "",
    @SerialName("advance_given") val advanceGiven: Double = 0.0,
    @SerialName("completion_date") val completionDate: String = "",
    @SerialName("full_bill_collected") val fullBillCollected: Boolean = false,
    @SerialName("payment_collected_at") val paymentCollectedAt: String = "",
    @SerialName("transport_cost") val transportCost: Double = 0.0,
    @SerialName("meals_cost") val mealsCost: Double = 0.0,
    @SerialName("other_expenses") val otherExpenses: List<OtherExpenseItem> = emptyList(),
    @SerialName("other_expenses_total") val otherExpensesTotal: Double = 0.0,
    @SerialName("worker_pay_total") val workerPayTotal: Double = 0.0,
    @SerialName("actual_expenses") val actualExpenses: Double = 0.0,
    @SerialName("job_profit") val jobProfit: Double = 0.0,
    @SerialName("return_visit_costs_total") val returnVisitCostsTotal: Double = 0.0,
    @SerialName("lifetime_job_profit") val lifetimeJobProfit: Double = 0.0,
    @SerialName("supervisor_settlement") val supervisorSettlement: Double = 0.0,
    @SerialName("settlement_confirmed") val settlementConfirmed: Boolean = false,
    @SerialName("followup_date") val followupDate: String = "",
    @SerialName("followup_rule_note") val followupRuleNote: String = "",
    @SerialName("followup_done") val followupDone: Boolean = false,
    @SerialName("is_no_charge_visit") val isNoChargeVisit: Boolean = false,
    @SerialName("parent_order_id") val parentOrderId: String = "",
    val notes: String = "",
    val workers: List<OrderWorkerAssignment> = emptyList()
) {
    val isStatusLocked: Boolean
        get() = statusLocked || (status == "Completed" && fullBillCollected)
}

@Serializable
data class BuildingInfo(
    val name: String = "",
    @SerialName("overhead_tank_count") val overheadTankCount: Int = 0,
    @SerialName("overhead_tank_capacity_liters") val overheadTankCapacityLiters: Int = 0,
    @SerialName("reserve_tank_count") val reserveTankCount: Int = 0,
    @SerialName("reserve_tank_capacity_liters") val reserveTankCapacityLiters: Int = 0,
    val floors: Int = 0,
    @SerialName("caretaker_name") val caretakerName: String = "",
    @SerialName("caretaker_phone") val caretakerPhone: String = "",
    @SerialName("access_notes") val accessNotes: String = ""
)

@Serializable
data class SupervisorJobView(
    @SerialName("order_id") val orderId: String = "",
    @SerialName("customer_name") val customerName: String = "",
    @SerialName("phone_display") val phoneDisplay: String = "",
    val address: String = "",
    val area: String = "",
    @SerialName("service_type") val serviceType: String = "",
    @SerialName("price_bdt") val priceBdt: Double = 0.0,
    @SerialName("scheduled_date") val scheduledDate: String = "",
    @SerialName("scheduled_time") val scheduledTime: String = "",
    val status: String = "Confirmed",
    @SerialName("status_locked") val statusLocked: Boolean = false,
    @SerialName("status_locked_at") val statusLockedAt: String = "",
    @SerialName("advance_given") val advanceGiven: Double = 0.0,
    @SerialName("is_no_charge_visit") val isNoChargeVisit: Boolean = false,
    val notes: String = "",
    @SerialName("full_bill_collected") val fullBillCollected: Boolean = false,
    @SerialName("completion_date") val completionDate: String = "",
    @SerialName("building_info") val buildingInfo: BuildingInfo? = null,
    val workers: List<OrderWorkerAssignment> = emptyList()
) {
    val isStatusLocked: Boolean
        get() = statusLocked || (status == "Completed" && fullBillCollected)
}

@Serializable
data class SupervisorJobsPayload(
    val todayDhaka: String = "",
    val endDateDhaka: String = "",
    val jobs: List<SupervisorJobView> = emptyList(),
    val companyLogoDataUrl: String = ""
)

@Serializable
data class CustomerProfile(
    @SerialName("customer_id") val customerId: String = "",
    val name: String = "",
    @SerialName("phone_display") val phoneDisplay: String = "",
    val address: String = "",
    val area: String = "",
    val notes: String = ""
)

@Serializable
data class LeadRecord(
    @SerialName("lead_id") val leadId: String = "",
    @SerialName("customer_name") val customerName: String = "",
    @SerialName("phone_display") val phoneDisplay: String = "",
    val address: String = "",
    val area: String = "",
    @SerialName("service_type") val serviceType: String = "",
    @SerialName("quoted_price_bdt") val quotedPriceBdt: Double = 0.0,
    val channel: String = "Phone",
    val stage: String = "New",
    @SerialName("followup_date") val followupDate: String = "",
    val notes: String = ""
)

@Serializable
data class QuotationItem(
    @SerialName("service_type") val serviceType: String = SunvilozConstants.DEFAULT_SERVICES.first(),
    val description: String = "",
    @SerialName("amount_bdt") val amountBdt: Double = 0.0
)

@Serializable
data class QuotationRecord(
    @SerialName("quotation_id") val quotationId: String = "",
    @SerialName("quotation_number") val quotationNumber: String = "",
    @SerialName("customer_name") val customerName: String = "",
    @SerialName("phone_display") val phoneDisplay: String = "",
    val address: String = "",
    val area: String = "",
    @SerialName("items_json") val itemsJson: String = "[]",
    @SerialName("subtotal_bdt") val subtotalBdt: Double = 0.0,
    @SerialName("discount_bdt") val discountBdt: Double = 0.0,
    @SerialName("total_bdt") val totalBdt: Double = 0.0,
    @SerialName("valid_until") val validUntil: String = "",
    val status: String = "Sent",
    @SerialName("converted_order_id") val convertedOrderId: String = "",
    val notes: String = ""
)

@Serializable
data class MoneyReceiptRecord(
    @SerialName("receipt_id") val receiptId: String = "",
    @SerialName("receipt_number") val receiptNumber: String = "",
    @SerialName("order_id") val orderId: String = "",
    @SerialName("customer_name") val customerName: String = "",
    @SerialName("phone_display") val phoneDisplay: String = "",
    val address: String = "",
    @SerialName("service_type") val serviceType: String = "",
    @SerialName("amount_bdt") val amountBdt: Double = 0.0,
    @SerialName("payment_method") val paymentMethod: String = "Cash",
    @SerialName("payment_date") val paymentDate: String = "",
    @SerialName("received_by") val receivedBy: String = ""
)

@Serializable
data class WorkerRecord(
    @SerialName("worker_id") val workerId: String = "",
    val name: String = "",
    @SerialName("phone_display") val phoneDisplay: String = "",
    @SerialName("role_label") val roleLabel: String = "Cleaner",
    @SerialName("default_daily_wage_bdt") val defaultDailyWageBdt: Double = 0.0,
    @SerialName("is_active") val isActive: Boolean = true
)

@Serializable
data class BackupHistoryRecord(
    @SerialName("backup_id") val backupId: String = "",
    val source: String = "",
    val status: String = "",
    @SerialName("file_name") val fileName: String = "",
    @SerialName("drive_file_id") val driveFileId: String = "",
    @SerialName("drive_account_email") val driveAccountEmail: String = "",
    @SerialName("size_bytes") val sizeBytes: Long = 0L,
    @SerialName("checksum_sha256") val checksumSha256: String = "",
    @SerialName("error_message") val errorMessage: String = "",
    @SerialName("created_at") val createdAt: String = ""
)

@Serializable
data class AppSettingsPayload(
    @SerialName("default_followup_value") val defaultFollowupValue: String = "6",
    @SerialName("default_followup_unit") val defaultFollowupUnit: String = "months",
    @SerialName("reminder_email") val reminderEmail: String = "",
    @SerialName("primary_owner_google_email") val primaryOwnerGoogleEmail: String = "",
    @SerialName("sync_revision") val syncRevision: Int = 1,
    @SerialName("reminder_trigger_status") val reminderTriggerStatus: String = "",
    @SerialName("secondary_drive_email") val secondaryDriveEmail: String = "",
    @SerialName("secondary_drive_folder_name") val secondaryDriveFolderName: String = "SUNVILOZ Clean Care Backups",
    @SerialName("auto_backup_enabled") val autoBackupEnabled: Boolean = false,
    @SerialName("auto_backup_hour") val autoBackupHour: String = "2",
    @SerialName("last_verified_backup_at") val lastVerifiedBackupAt: String = "",
    @SerialName("last_verified_backup_file") val lastVerifiedBackupFile: String = "",
    @SerialName("last_backup_error") val lastBackupError: String = ""
)

@Serializable
data class AdminBootstrapPayload(
    val todayDhaka: String = "",
    val services: List<String> = SunvilozConstants.DEFAULT_SERVICES,
    val orders: List<OrderRecord> = emptyList(),
    val customers: List<CustomerProfile> = emptyList(),
    val leads: List<LeadRecord> = emptyList(),
    val quotations: List<QuotationRecord> = emptyList(),
    val receipts: List<MoneyReceiptRecord> = emptyList(),
    val workers: List<WorkerRecord> = emptyList(),
    val supervisors: List<AuthUser> = emptyList(),
    val backupHistory: List<BackupHistoryRecord> = emptyList(),
    val settings: AppSettingsPayload = AppSettingsPayload()
)

@Serializable
data class MonthlyReportSummary(
    @SerialName("completed_jobs") val completedJobs: Int = 0,
    @SerialName("no_charge_return_visits") val noChargeReturnVisits: Int = 0,
    @SerialName("income_collected") val incomeCollected: Double = 0.0,
    @SerialName("completed_job_bills") val completedJobBills: Double = 0.0,
    @SerialName("actual_job_costs") val actualJobCosts: Double = 0.0,
    @SerialName("job_profit_loss") val jobProfitLoss: Double = 0.0,
    @SerialName("general_business_expenses") val generalBusinessExpenses: Double = 0.0,
    @SerialName("net_business_profit") val netBusinessProfit: Double? = null
)

@Serializable
data class MonthlyReportRow(
    @SerialName("order_id") val orderId: String = "",
    @SerialName("completion_date") val completionDate: String = "",
    @SerialName("customer_name") val customerName: String = "",
    val area: String = "",
    @SerialName("service_type") val serviceType: String = "",
    @SerialName("supervisor_name") val supervisorName: String = "",
    @SerialName("is_no_charge_visit") val isNoChargeVisit: Boolean = false,
    @SerialName("bill_bdt") val billBdt: Double = 0.0,
    @SerialName("collected_bdt") val collectedBdt: Double = 0.0,
    @SerialName("actual_job_cost") val actualJobCost: Double = 0.0,
    @SerialName("job_profit") val jobProfit: Double = 0.0
)

@Serializable
data class MonthlyReportPayload(
    val period: String = "",
    val year: Int = 2026,
    val month: Int = 1,
    val filtersApplied: Boolean = false,
    val summary: MonthlyReportSummary = MonthlyReportSummary(),
    val rows: List<MonthlyReportRow> = emptyList()
)

@Serializable
data class BackupValidationCounts(
    val users: Int = 0,
    val orders: Int = 0,
    val customers: Int = 0,
    val buildings: Int = 0,
    val leads: Int = 0,
    val quotations: Int = 0,
    val receipts: Int = 0,
    val workers: Int = 0,
    @SerialName("document_pads") val documentPads: Int = 0,
    @SerialName("issued_pdfs") val issuedPdfs: Int = 0,
    @SerialName("has_logo") val hasLogo: Boolean = false
)

@Serializable
data class BackupValidationSummary(
    val valid: Boolean = false,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("created_by") val createdBy: String = "",
    @SerialName("checksum_sha256") val checksumSha256: String = "",
    val counts: BackupValidationCounts = BackupValidationCounts()
)
