"""
VISTA Report Exporter.

Generates Excel (multi-sheet) and PDF investigation reports
from analysis results.
"""

from __future__ import annotations

import io
import os
from datetime import datetime

import pandas as pd

# We'll import reportlab lazily to avoid hard crash if not installed
_REPORTLAB_AVAILABLE = False
try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm, inch
    from reportlab.platypus import (
        SimpleDocTemplate,
        Table,
        TableStyle,
        Paragraph,
        Spacer,
        PageBreak,
    )
    _REPORTLAB_AVAILABLE = True
except ImportError:
    pass


def _money_str(value) -> str:
    try:
        v = float(value or 0)
    except (TypeError, ValueError):
        return "0.00"
    if v != v:
        return "0.00"
    return f"{v:,.2f}"


import re

def _money_inr(value) -> str:
    return f"₹{_money_str(value)}"

# XML 1.0 illegal characters regex
ILLEGAL_XML_RE = re.compile(
    "[\x00-\x08\x0b\x0c\x0e-\x1F\uD800-\uDFFF\uFFFE\uFFFF\U0000FDD0-\U0000FDEF]"
)

def sanitize_xml_text(value) -> str:
    """Strip XML-illegal characters that corrupt openpyxl."""
    if value is None:
        return ""
    if not isinstance(value, str):
        return value
    return ILLEGAL_XML_RE.sub(" ", value)


# ---------------------------------------------------------------------------
# Excel Export
# ---------------------------------------------------------------------------

def export_excel(
    case_data: dict,
    transactions: list[dict],
    analysis: dict,
) -> bytes:
    """Generate a multi-sheet Excel workbook and return as bytes."""
    # Issue 3: Use normalized_transactions from analysis if available, otherwise raw
    export_txns = analysis.get("normalized_transactions", transactions)
    output = io.BytesIO()

    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        # Sheet 1: Case Summary
        summary = analysis.get("summary", {})
        summary_rows = [
            ["Case Name", sanitize_xml_text(case_data.get("name", ""))],
            ["Investigator", sanitize_xml_text(case_data.get("investigator", ""))],
            ["Generated At", datetime.now().strftime("%Y-%m-%d %H:%M:%S")],
            [""],
            ["Total Source Files", summary.get("total_source_files", 0) if summary.get("total_source_files") not in (None, "") else 0],
            ["Total Primary Accounts", summary.get("total_primary_accounts", 0) if summary.get("total_primary_accounts") not in (None, "") else 0],
            ["Total Unique Accounts", summary.get("total_unique_accounts", 0) if summary.get("total_unique_accounts") not in (None, "") else 0],
            ["Total Transactions", summary.get("total_transactions", 0) if summary.get("total_transactions") not in (None, "") else 0],
            ["Date Range", sanitize_xml_text(summary.get("date_range", ""))],
            ["Total Debit (₹)", summary.get("total_debit", 0) if summary.get("total_debit") not in (None, "") else 0],
            ["Total Credit (₹)", summary.get("total_credit", 0) if summary.get("total_credit") not in (None, "") else 0],
            [""],
            ["Round Trips Detected", summary.get("round_trips_detected", 0) if summary.get("round_trips_detected") not in (None, "") else 0],
            ["Suspicious Accounts", summary.get("suspicious_accounts_count", 0) if summary.get("suspicious_accounts_count") not in (None, "") else 0],
            ["Critical Risk Accounts", summary.get("critical_accounts", 0) if summary.get("critical_accounts") not in (None, "") else 0],
            ["High Risk Accounts", summary.get("high_risk_accounts", 0) if summary.get("high_risk_accounts") not in (None, "") else 0],
        ]
        pd.DataFrame(summary_rows, columns=["Metric", "Value"]).to_excel(
            writer, sheet_name="Case Summary", index=False
        )

        # Sheet 2: All Transactions
        if export_txns:
            tx_cols = [
                "date", "narration", "debit", "credit", "balance",
                "source_file", "account_no", "counterparty_account",
                "upi_id", "ifsc", "tran_id", "is_reversed", "review_reasons",
            ]
            tx_data = []
            for txn in export_txns:
                row = {col: sanitize_xml_text(txn.get(col)) for col in tx_cols}
                tx_data.append(row)
            pd.DataFrame(tx_data).to_excel(
                writer, sheet_name="All Transactions", index=False
            )

        # Sheet 3: Verified Fund Flows
        fund_flows = analysis.get("fund_flow_summary", [])
        verified_flows = [f for f in fund_flows if f.get("confidence_level") == "VERIFIED"]
        if verified_flows:
            pd.DataFrame(verified_flows).to_excel(
                writer, sheet_name="Verified Fund Flows", index=False
            )
            
        # Sheet 3b: Possible Leads
        possible_flows = [f for f in fund_flows if f.get("confidence_level") == "POSSIBLE"]
        if possible_flows:
            pd.DataFrame(possible_flows).to_excel(
                writer, sheet_name="Possible Leads", index=False
            )

        # Sheet 4: Round Trip Cycles
        round_trips = analysis.get("round_trips", [])
        if round_trips:
            rt_rows = []
            for i, rt in enumerate(round_trips, 1):
                rt_rows.append({
                    "Cycle #": i,
                    "Path": " → ".join(rt["cycle_path"]),
                    "Hops": rt["num_hops"],
                    "Total Amount (₹)": rt["total_amount"],
                    "Min Edge Amount (₹)": rt["min_edge_amount"],
                    "Date Range": rt["date_range"],
                    "Risk Score": rt["risk_score"],
                })
            pd.DataFrame(rt_rows).to_excel(
                writer, sheet_name="Round Trip Cycles", index=False
            )

            # Also add hop details
            hop_rows = []
            for i, rt in enumerate(round_trips, 1):
                for hop in rt.get("hops", []):
                    hop_rows.append({
                        "Cycle #": i,
                        "From": hop["from"],
                        "To": hop["to"],
                        "Amount (₹)": hop["amount"],
                        "Transactions": hop["count"],
                        "Date Range": hop["date_range"],
                    })
            if hop_rows:
                pd.DataFrame(hop_rows).to_excel(
                    writer, sheet_name="Cycle Hop Details", index=False
                )

        # Sheet 5: Money Trail
        money_trail = analysis.get("money_trail", [])
        if money_trail:
            mt_rows = []
            for i, trail in enumerate(money_trail, 1):
                for dest in trail.get("destinations", []):
                    mt_rows.append({
                        "Trail #": i,
                        "Account": trail["account"],
                        "Credit Date": trail["credit_date"],
                        "Credit Amount (₹)": trail["credit_amount"],
                        "Credit From": trail["credit_source"],
                        "Debit Date": dest["date"],
                        "Debit Amount (₹)": dest["amount"],
                        "Debit To": dest["destination"],
                        "Narration": dest["narration"],
                    })
            if mt_rows:
                pd.DataFrame(mt_rows).to_excel(
                    writer, sheet_name="Money Trail", index=False
                )

        # Sheet 6: Suspicious Accounts
        suspicious = analysis.get("suspicious_accounts", [])
        if suspicious:
            sa_rows = []
            for acc in suspicious:
                sa_rows.append({
                    "Account ID": sanitize_xml_text(acc["account_id"]),
                    "Is Primary": "Yes" if acc["is_primary"] else "No",
                    "Total In (₹)": acc.get("total_in", 0) if acc.get("total_in") not in (None, "") else 0,
                    "Total Out (₹)": acc.get("total_out", 0) if acc.get("total_out") not in (None, "") else 0,
                    "Net Flow (₹)": acc.get("net_flow", 0) if acc.get("net_flow") not in (None, "") else 0,
                    "Transactions": acc.get("tx_count", 0) if acc.get("tx_count") not in (None, "") else 0,
                    "Fan In": acc.get("fan_in", 0) if acc.get("fan_in") not in (None, "") else 0,
                    "Fan Out": acc.get("fan_out", 0) if acc.get("fan_out") not in (None, "") else 0,
                    "Risk Level": acc["risk_level"],
                    "Reasons": sanitize_xml_text("; ".join(acc["reasons"])),
                })
            pd.DataFrame(sa_rows).to_excel(
                writer, sheet_name="Suspicious Accounts", index=False
            )

    return output.getvalue()


# ---------------------------------------------------------------------------
# PDF Export
# ---------------------------------------------------------------------------

def export_pdf(
    case_data: dict,
    transactions: list[dict],
    analysis: dict,
) -> bytes:
    """Generate a PDF investigation report."""
    export_txns = analysis.get("normalized_transactions", transactions)
    
    if not _REPORTLAB_AVAILABLE:
        # Fallback: return a simple text-based PDF-like summary
        return _fallback_pdf(case_data, transactions, analysis)

    output = io.BytesIO()
    doc = SimpleDocTemplate(
        output,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "VTitle", parent=styles["Title"],
        fontSize=22, spaceAfter=6 * mm, textColor=colors.HexColor("#1a1a2e"),
    )
    heading_style = ParagraphStyle(
        "VHeading", parent=styles["Heading2"],
        fontSize=14, spaceBefore=8 * mm, spaceAfter=4 * mm,
        textColor=colors.HexColor("#1a1a2e"),
    )
    sub_style = ParagraphStyle(
        "VSub", parent=styles["Normal"],
        fontSize=9, textColor=colors.HexColor("#555555"), spaceAfter=2 * mm,
    )
    body_style = ParagraphStyle(
        "VBody", parent=styles["Normal"],
        fontSize=10, spaceAfter=2 * mm,
    )

    elements: list = []

    # --- Cover ---
    elements.append(Spacer(1, 30 * mm))
    elements.append(Paragraph("VISTA Investigation Report", title_style))
    elements.append(Paragraph(
        f"Case: {case_data.get('name', 'N/A')}<br/>"
        f"Investigator: {case_data.get('investigator', 'N/A')}<br/>"
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        sub_style,
    ))
    elements.append(Spacer(1, 10 * mm))

    # --- Executive Summary ---
    summary = analysis.get("summary", {})
    elements.append(Paragraph("Executive Summary", heading_style))

    summary_data = [
        ["Metric", "Value"],
        ["Total Source Files", str(summary.get("total_source_files", 0))],
        ["Total Primary Accounts", str(summary.get("total_primary_accounts", 0))],
        ["Total Unique Accounts", str(summary.get("total_unique_accounts", 0))],
        ["Total Transactions", str(summary.get("total_transactions", 0))],
        ["Date Range", summary.get("date_range", "N/A")],
        ["Total Debit", _money_inr(summary.get("total_debit", 0))],
        ["Total Credit", _money_inr(summary.get("total_credit", 0))],
        ["Round Trips Detected", str(summary.get("round_trips_detected", 0))],
        ["Suspicious Accounts", str(summary.get("suspicious_accounts_count", 0))],
        ["Critical Risk", str(summary.get("critical_accounts", 0))],
        ["High Risk", str(summary.get("high_risk_accounts", 0))],
    ]
    t = Table(summary_data, colWidths=[55 * mm, 80 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(t)

    # --- Round Trips ---
    round_trips = analysis.get("round_trips", [])
    elements.append(Paragraph(f"Round Trip Cycles ({len(round_trips)} detected)", heading_style))
    if round_trips:
        rt_data = [["#", "Path", "Amount (₹)", "Hops", "Risk"]]
        for i, rt in enumerate(round_trips[:20], 1):
            path_str = " → ".join(rt["cycle_path"])
            # Truncate long paths
            if len(path_str) > 60:
                path_str = path_str[:57] + "..."
            rt_data.append([
                str(i),
                path_str,
                _money_str(rt["total_amount"]),
                str(rt["num_hops"]),
                rt["risk_score"],
            ])
        t = Table(rt_data, colWidths=[8 * mm, 75 * mm, 30 * mm, 15 * mm, 22 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        elements.append(t)
    else:
        elements.append(Paragraph("No round-trip cycles detected.", body_style))

    # --- Suspicious Accounts ---
    suspicious = analysis.get("suspicious_accounts", [])
    elements.append(Paragraph(f"Suspicious Accounts ({len(suspicious)} flagged)", heading_style))
    if suspicious:
        sa_data = [["Account", "In (₹)", "Out (₹)", "Net (₹)", "Risk", "Reasons"]]
        for acc in suspicious[:25]:
            acc_id = acc["account_id"]
            if len(acc_id) > 18:
                acc_id = acc_id[:15] + "..."
            reasons = "; ".join(acc["reasons"])
            if len(reasons) > 40:
                reasons = reasons[:37] + "..."
            sa_data.append([
                acc_id,
                _money_str(acc["total_in"]),
                _money_str(acc["total_out"]),
                _money_str(acc["net_flow"]),
                acc["risk_level"],
                reasons,
            ])
        t = Table(sa_data, colWidths=[28 * mm, 22 * mm, 22 * mm, 22 * mm, 18 * mm, 45 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        elements.append(t)
    else:
        elements.append(Paragraph("No suspicious accounts flagged.", body_style))

    # --- Top Fund Flows ---
    fund_flows = analysis.get("fund_flow_summary", [])
    elements.append(Paragraph(f"Top Fund Flows ({len(fund_flows)} total pairs)", heading_style))
    if fund_flows:
        ff_data = [["Source", "Destination", "Amount (₹)", "Count", "Date Range"]]
        for ff in fund_flows[:20]:
            src = ff["source"]
            dst = ff["destination"]
            if len(src) > 18:
                src = src[:15] + "..."
            if len(dst) > 18:
                dst = dst[:15] + "..."
            ff_data.append([
                src, dst,
                _money_str(ff["total_amount"]),
                str(ff["transaction_count"]),
                ff.get("date_range", ""),
            ])
        t = Table(ff_data, colWidths=[30 * mm, 30 * mm, 28 * mm, 15 * mm, 45 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        elements.append(t)

    # --- Footer ---
    elements.append(Spacer(1, 10 * mm))
    elements.append(Paragraph(
        "Report generated by VISTA — Automated Bank Statement Analysis System",
        sub_style,
    ))

    doc.build(elements)
    return output.getvalue()


def _fallback_pdf(case_data: dict, transactions: list[dict], analysis: dict) -> bytes:
    """Simple fallback if reportlab is not installed."""
    lines = [
        "VISTA Investigation Report",
        "=" * 40,
        f"Case: {case_data.get('name', 'N/A')}",
        f"Investigator: {case_data.get('investigator', 'N/A')}",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
    ]
    summary = analysis.get("summary", {})
    for key, val in summary.items():
        if key != "top_flows":
            lines.append(f"{key}: {val}")

    lines.append("")
    lines.append(f"Round Trips: {len(analysis.get('round_trips', []))}")
    lines.append(f"Suspicious Accounts: {len(analysis.get('suspicious_accounts', []))}")

    return "\n".join(lines).encode("utf-8")
