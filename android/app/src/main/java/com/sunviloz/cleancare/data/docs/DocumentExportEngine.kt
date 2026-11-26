package com.sunviloz.cleancare.data.docs

import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import com.sunviloz.cleancare.data.model.MoneyReceiptRecord
import com.sunviloz.cleancare.data.model.MonthlyReportPayload
import com.sunviloz.cleancare.data.model.QuotationItem
import com.sunviloz.cleancare.data.model.QuotationRecord
import com.sunviloz.cleancare.data.model.SunvilozConstants
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Native Android document generator for:
 * 1. SUNVILOZ Clean Care English A4 Quotation PDF (established layout, WHO steps, exact services, BDT)
 * 2. SUNVILOZ Clean Care English A4 Money Receipt PDF
 * 3. Monthly Jobs & Income XLSX spreadsheet matching the on-screen report totals identically
 */
object DocumentExportEngine {

    private val json = Json { ignoreUnknownKeys = true }

    private fun exportsDir(context: Context): File =
        File(context.cacheDir, "exports").apply { mkdirs() }

    fun generateQuotationPdf(context: Context, quotation: QuotationRecord): File {
        val items = runCatching { json.decodeFromString<List<QuotationItem>>(quotation.itemsJson) }
            .getOrDefault(emptyList())
        val doc = PdfDocument()
        val pageInfo = PdfDocument.PageInfo.Builder(595, 842, 1).create() // A4 at 72 dpi
        val page = doc.startPage(pageInfo)
        val canvas = page.canvas

        // Draw official SUNVILOZ Clean Care letterhead pad background full-bleed on A4
        val padBitmap = runCatching {
            context.assets.open("sunviloz_quotation_pad.jpg").use { stream ->
                android.graphics.BitmapFactory.decodeStream(stream)
            }
        }.getOrNull()
        val hasOfficialPad = padBitmap != null
        if (padBitmap != null) {
            val destRect = android.graphics.Rect(0, 0, 595, 842)
            val bmpPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
            canvas.drawBitmap(padBitmap, null, destRect, bmpPaint)
            padBitmap.recycle()
        }

        val navy = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#0B1F3A")
            textSize = 15f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val teal = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#0F766E")
            textSize = 10.5f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val body = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#1E293B")
            textSize = 10f
        }
        val boldBody = Paint(body).apply { typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD) }
        val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#CBD5E1"); strokeWidth = 1f }
        val headerBg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#E6F1F5F9") }

        var y: Float
        if (hasOfficialPad) {
            // Start cleanly below the official SUNVILOZ CLEAN CARE pad header & contact block
            y = 160f
            canvas.drawText("QUOTATION", 42f, y, navy)
            canvas.drawText("Ref: ${quotation.quotationNumber}", 395f, y, boldBody)
            y += 14f
            canvas.drawText("Date: ${SunvilozConstants.todayDhakaIso()}  |  Valid Until: ${quotation.validUntil.ifBlank { "15 Days" }}", 42f, y, body)
            y += 12f
            canvas.drawLine(42f, y, 553f, y, linePaint)
        } else {
            y = 52f
            canvas.drawText("SUNVILOZ Clean Care", 42f, y, navy)
            canvas.drawText("QUOTATION", 460f, y, navy)
            y += 18f
            canvas.drawText("Professional Water Tank & Pipeline Cleaning Service", 42f, y, teal)
            canvas.drawText("Ref: ${quotation.quotationNumber}", 430f, y, boldBody)
            y += 14f
            canvas.drawText("Dhaka, Bangladesh  |  All amounts in BDT", 42f, y, body)
            canvas.drawText("Valid Until: ${quotation.validUntil}", 430f, y, body)
            y += 16f
            canvas.drawLine(42f, y, 553f, y, linePaint)
        }

        y += 20f
        canvas.drawText("Prepared For:", 42f, y, boldBody)
        y += 14f
        canvas.drawText(quotation.customerName, 42f, y, boldBody)
        y += 13f
        canvas.drawText("Phone: ${quotation.phoneDisplay}", 42f, y, body)
        y += 13f
        canvas.drawText("Address: ${quotation.address}${if (quotation.area.isNotBlank()) " (${quotation.area})" else ""}", 42f, y, body)

        y += 22f
        canvas.drawRect(42f, y - 13f, 553f, y + 7f, headerBg)
        canvas.drawLine(42f, y - 13f, 553f, y - 13f, linePaint)
        canvas.drawText("#", 48f, y, boldBody)
        canvas.drawText("Service / Scope", 74f, y, boldBody)
        canvas.drawText("Amount (BDT)", 445f, y, boldBody)
        y += 7f
        canvas.drawLine(42f, y, 553f, y, linePaint)

        items.forEachIndexed { idx, item ->
            y += 18f
            canvas.drawText("${idx + 1}", 48f, y, body)
            canvas.drawText(item.serviceType, 74f, y, boldBody)
            canvas.drawText(SunvilozConstants.formatBdt(item.amountBdt), 445f, y, body)
            val note = item.description.ifBlank { SunvilozConstants.PACKAGE_INCLUSIONS[item.serviceType].orEmpty() }
            if (note.isNotBlank()) {
                y += 12f
                canvas.drawText(note.take(78), 74f, y, body)
            }
        }

        y += 16f
        canvas.drawLine(42f, y, 553f, y, linePaint)
        y += 18f
        canvas.drawText("Subtotal:", 350f, y, body)
        canvas.drawText(SunvilozConstants.formatBdt(quotation.subtotalBdt), 445f, y, body)
        if (quotation.discountBdt > 0) {
            y += 15f
            canvas.drawText("Discount:", 350f, y, body)
            canvas.drawText("- ${SunvilozConstants.formatBdt(quotation.discountBdt)}", 445f, y, body)
        }
        y += 18f
        canvas.drawText("Total Agreed Price:", 330f, y, boldBody)
        canvas.drawText(SunvilozConstants.formatBdt(quotation.totalBdt), 445f, y, Paint(navy).apply { textSize = 12f })

        y += 28f
        canvas.drawText("6-Step Hygienic Cleaning Process (WHO Guidelines):", 42f, y, teal)
        val steps = listOf(
            "1. Mechanical dewatering & sludge removal",
            "2. High-pressure wall, ceiling & floor jet scrubbing",
            "3. Vacuum extraction of residual sediment",
            "4. Food-grade antibacterial disinfection treatment",
            "5. UV / final clean-water rinsing & pipeline flushing (when included)",
            "6. Post-cleaning inspection & handover"
        )
        steps.forEach { step ->
            y += 14f
            canvas.drawText(step, 46f, y, body)
        }

        if (quotation.notes.isNotBlank()) {
            y += 20f
            canvas.drawText("Notes: ${quotation.notes.take(90)}", 42f, y, body)
        }

        // Positioned cleanly above the pad's orange double bottom border (at y ~ 825)
        canvas.drawLine(42f, 768f, 225f, 768f, linePaint)
        canvas.drawText("Authorized Signature — SUNVILOZ Clean Care", 42f, 783f, boldBody)
        doc.finishPage(page)

        val outFile = File(exportsDir(context), "${quotation.quotationNumber.ifBlank { "Quotation" }}.pdf")
        FileOutputStream(outFile).use { doc.writeTo(it) }
        doc.close()
        return outFile
    }

    fun generateMoneyReceiptPdf(context: Context, receipt: MoneyReceiptRecord): File {
        val doc = PdfDocument()
        val pageInfo = PdfDocument.PageInfo.Builder(595, 420, 1).create()
        val page = doc.startPage(pageInfo)
        val canvas = page.canvas

        val navy = Paint().apply {
            color = Color.parseColor("#0B1F3A")
            textSize = 18f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val teal = Paint().apply {
            color = Color.parseColor("#0F766E")
            textSize = 11f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val body = Paint().apply { color = Color.parseColor("#1E293B"); textSize = 11f }
        val boldBody = Paint(body).apply { typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD) }
        val linePaint = Paint().apply { color = Color.parseColor("#CBD5E1"); strokeWidth = 1f }

        var y = 46f
        canvas.drawText("SUNVILOZ Clean Care", 42f, y, navy)
        canvas.drawText("MONEY RECEIPT", 420f, y, navy)
        y += 18f
        canvas.drawText("Receipt No: ${receipt.receiptNumber}", 42f, y, teal)
        canvas.drawText("Date: ${receipt.paymentDate}", 420f, y, boldBody)
        y += 14f
        canvas.drawLine(42f, y, 553f, y, linePaint)

        y += 28f
        canvas.drawText("Order ID: ${receipt.orderId}", 42f, y, boldBody)
        y += 20f
        canvas.drawText("Received with thanks from: ${receipt.customerName}", 42f, y, boldBody)
        y += 18f
        canvas.drawText("Phone: ${receipt.phoneDisplay}", 42f, y, body)
        y += 18f
        canvas.drawText("Address: ${receipt.address.take(80)}", 42f, y, body)
        y += 18f
        canvas.drawText("Service: ${receipt.serviceType}", 42f, y, body)
        y += 26f
        canvas.drawText("Amount Received: ${SunvilozConstants.formatBdt(receipt.amountBdt)}", 42f, y, navy.apply { textSize = 14f })
        y += 20f
        canvas.drawText("Payment Method: ${receipt.paymentMethod}   |   Received By: ${receipt.receivedBy}", 42f, y, body)

        y += 58f
        canvas.drawLine(42f, y, 220f, y, linePaint)
        canvas.drawLine(370f, y, 553f, y, linePaint)
        y += 15f
        canvas.drawText("Customer Signature", 70f, y, body)
        canvas.drawText("Authorized Signature", 405f, y, body)

        doc.finishPage(page)
        val outFile = File(exportsDir(context), "${receipt.receiptNumber.ifBlank { "Receipt" }}.pdf")
        FileOutputStream(outFile).use { doc.writeTo(it) }
        doc.close()
        return outFile
    }

    /**
     * Generates a standards-compliant .xlsx workbook directly from the exact same
     * MonthlyReportPayload rendered on-screen so rows and totals always match 100%.
     */
    fun generateMonthlyReportXlsx(context: Context, report: MonthlyReportPayload): File {
        val outFile = File(exportsDir(context), "SUNVILOZ_Monthly_Jobs_Income_${report.period}.xlsx")
        val rowsXml = buildString {
            var r = 1
            fun addRow(cells: List<Any?>) {
                append("<row r=\"$r\">")
                cells.forEachIndexed { idx, value ->
                    val col = ('A'.code + idx).toChar()
                    val ref = "$col$r"
                    when (value) {
                        is Number -> append("<c r=\"$ref\"><v>$value</v></c>")
                        else -> {
                            val escaped = (value?.toString() ?: "")
                                .replace("&", "&amp;")
                                .replace("<", "&lt;")
                                .replace(">", "&gt;")
                            append("<c r=\"$ref\" t=\"inlineStr\"><is><t>$escaped</t></is></c>")
                        }
                    }
                }
                append("</row>")
                r++
            }

            addRow(listOf("SUNVILOZ Clean Care — Monthly Jobs & Income (${report.period})"))
            addRow(listOf("Metric", "Value"))
            addRow(listOf("Completed Jobs", report.summary.completedJobs))
            addRow(listOf("No-Charge Return Visits", report.summary.noChargeReturnVisits))
            addRow(listOf("Income Collected (BDT)", report.summary.incomeCollected))
            addRow(listOf("Completed Job Bills (BDT)", report.summary.completedJobBills))
            addRow(listOf("Actual Job Costs (BDT)", report.summary.actualJobCosts))
            addRow(listOf("Job Profit / Loss (BDT)", report.summary.jobProfitLoss))
            addRow(listOf("General Business Expenses (BDT)", report.summary.generalBusinessExpenses))
            addRow(listOf("Net Business Profit (BDT)", report.summary.netBusinessProfit ?: "N/A (Job Filter Active)"))
            addRow(emptyList())
            addRow(listOf("Order ID", "Completion Date", "Customer", "Area", "Service", "Supervisor", "Bill (BDT)", "Collected (BDT)", "Actual Cost (BDT)", "Job Profit (BDT)"))
            report.rows.forEach { row ->
                addRow(
                    listOf(
                        row.orderId,
                        row.completionDate,
                        row.customerName,
                        row.area,
                        row.serviceType,
                        row.supervisorName,
                        row.billBdt,
                        row.collectedBdt,
                        row.actualJobCost,
                        row.jobProfit
                    )
                )
            }
        }

        ZipOutputStream(FileOutputStream(outFile)).use { zos ->
            fun putEntry(name: String, content: String) {
                zos.putNextEntry(ZipEntry(name))
                zos.write(content.toByteArray(Charsets.UTF_8))
                zos.closeEntry()
            }
            putEntry(
                "[Content_Types].xml",
                """<?xml version="1.0" encoding="UTF-8"?>
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                  <Default Extension="xml" ContentType="application/xml"/>
                  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
                  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
                </Types>""".trimIndent()
            )
            putEntry(
                "_rels/.rels",
                """<?xml version="1.0" encoding="UTF-8"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
                </Relationships>""".trimIndent()
            )
            putEntry(
                "xl/workbook.xml",
                """<?xml version="1.0" encoding="UTF-8"?>
                <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                  <sheets><sheet name="Monthly Jobs &amp; Income" sheetId="1" r:id="rId1"/></sheets>
                </workbook>""".trimIndent()
            )
            putEntry(
                "xl/_rels/workbook.xml.rels",
                """<?xml version="1.0" encoding="UTF-8"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
                </Relationships>""".trimIndent()
            )
            putEntry(
                "xl/worksheets/sheet1.xml",
                """<?xml version="1.0" encoding="UTF-8"?>
                <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                  <sheetData>$rowsXml</sheetData>
                </worksheet>""".trimIndent()
            )
        }
        return outFile
    }
}
