"""Unit tests for processors: dates, ticket parsing, column mapping, status normalization, template parsing."""
from __future__ import annotations

from datetime import date, datetime
from pathlib import Path

from app.processors.column_mapper import WORK_ITEM_FIELDS, find_header_row, map_columns
from app.processors.excel_reader import read_workbook, list_sheet_names
from app.processors.status_normalizer import StatusNormalizer
from app.processors.template_parser import TemplateParser, employee_from_path
from app.processors.ticket_parser import extract_ticket_ids, ticket_from_url
from app.utils.dates import parse_date_from_filename, parse_date_value, resolve_report_date


# ---------------------------------------------------------------- dates
def test_parse_date_values():
    assert parse_date_value(datetime(2026, 10, 30)) == date(2026, 10, 30)
    assert parse_date_value("2026-10-30 00:00:00") == date(2026, 10, 30)
    assert parse_date_value("30-10-2026") == date(2026, 10, 30)
    assert parse_date_value("30/10/2026") == date(2026, 10, 30)
    assert parse_date_value("16 Oct 26") == date(2026, 10, 16)
    assert parse_date_value(46325) == date(2026, 10, 30)  # Excel serial
    assert parse_date_value("not a date") is None
    assert parse_date_value(None) is None


def test_parse_date_from_filename_variants():
    assert parse_date_from_filename("Suraj_Shende-30-10-2026.xlsx") == date(2026, 10, 30)
    assert parse_date_from_filename("Karthik_Palanisamy-2-11-2026.xlsx") == date(2026, 11, 2)
    assert parse_date_from_filename("Sharma Ravi_20261023.xlsx") == date(2026, 10, 23)
    assert parse_date_from_filename("RohitJana_10302026.xlsx") == date(2026, 10, 30)
    assert parse_date_from_filename("Anil_Prasad_16 Oct 26.xlsx") == date(2026, 10, 16)
    assert parse_date_from_filename("Shyam_19_oct_2026.xlsx") == date(2026, 10, 19)
    assert parse_date_from_filename("Tanuj_15_10_2026.xlsx") == date(2026, 10, 15)
    assert parse_date_from_filename("nodate.xlsx") is None


def test_resolve_report_date_fallback_and_swap():
    r = resolve_report_date("19/15/2026", "K-19-10-2026.xlsx")
    assert r.value == date(2026, 10, 19) and r.source == "filename" and r.note
    r = resolve_report_date(datetime(2026, 2, 11), "K-2-11-2026.xlsx")
    assert r.value == date(2026, 11, 2) and "corrected" in r.source
    r = resolve_report_date(datetime(2026, 10, 30), "x.xlsx")
    assert r.value == date(2026, 10, 30) and r.source == "cell" and r.note is None
    r = resolve_report_date(None, "x.xlsx")
    assert r.value is None and not r.valid


# ---------------------------------------------------------------- tickets
def test_extract_ticket_ids():
    assert extract_ticket_ids("OCS-5777").ticket_ids == ["OCS-5777"]
    assert extract_ticket_ids("ocs-5777, OCS-5778 / MED-1").ticket_ids == ["OCS-5777", "OCS-5778", "MED-1"]
    assert extract_ticket_ids("OMRET - 2894").ticket_ids == ["OMRET-2894"]
    assert extract_ticket_ids("https://x.atlassian.net/browse/MRE-19520").ticket_ids == ["MRE-19520"]
    e = extract_ticket_ids("No Jira")
    assert not e.has_ticket and e.note == "no jira reference"
    e = extract_ticket_ids("OCS")
    assert not e.has_ticket and "project key only" in e.note
    assert not extract_ticket_ids(None).has_ticket
    assert not extract_ticket_ids("2").has_ticket
    assert ticket_from_url("https://x/browse/OCS-5777") == "OCS-5777"


# ---------------------------------------------------------------- column mapping
def test_map_columns_variants():
    hdr = ["Application Name", "Jira/OS Ticket ID", "Jira Ticket Link", "Work Details", "Work Type", "Work Status",
           "Production Deployment Required?", "Dev Deployment Status", "Additional Comments"]
    m = map_columns(hdr, WORK_ITEM_FIELDS)
    assert m.fields["ticket_id"] == 1 and m.fields["work_status"] == 5
    assert m.fields["prod_required"] == 6 and m.fields["dev_deployment"] == 7 and m.fields["comments"] == 8
    m2 = map_columns(["Jira TicketID ", "Description", "Status", "Environment", "Closing Comments"], WORK_ITEM_FIELDS)
    assert m2.fields["ticket_id"] == 0 and m2.fields["work_status"] == 2 and m2.fields["work_details"] == 1
    assert m2.fields["environment"] == 3 and m2.fields["comments"] == 4


def test_map_columns_overrides_win():
    hdr = ["Col A", "Col B", "Status"]
    m = map_columns(hdr, WORK_ITEM_FIELDS, overrides={"ticket_id": "Col A", "work_details": "Col B"})
    assert m.fields["ticket_id"] == 0 and m.fields["work_details"] == 1 and m.fields["work_status"] == 2


def test_find_header_row_skips_form_section():
    grid = [["Title"], ["Date:", "x"], ["Employee Name :", "A"], [],
            ["Application Name", "Jira Ticket ID", "Work Details", "Work Status"], ["App", "A-1", "x", "Done"]]
    assert find_header_row(grid, WORK_ITEM_FIELDS, required=["ticket_id", "work_status"]) == 4


# ---------------------------------------------------------------- normalizer
def test_status_normalizer_defaults_and_unmapped(tmp_path: Path):
    n = StatusNormalizer(tmp_path / "cfg.json")
    assert n.normalize("work_status", "Completed").category == "completed"
    assert n.normalize("work_status", "Inprogress").category == "in_progress"
    assert n.normalize("work_status", "Done").category == "completed"
    assert n.normalize("work_status", "On Hold").category == "on_hold"
    assert n.normalize("work_status", "Completed - deployed to QA").category == "completed"
    r = n.normalize("work_status", "Galactic")
    assert r.category == "other" and not r.mapped
    assert n.unmapped_values()["work_status"]["Galactic"] == 1
    assert n.normalize("work_status", None).category == "other"
    assert n.normalize("dev_deployment", "Not Applicable").category == "not_required"
    assert n.normalize("prod_deployment", "Deployed").category == "released"
    assert n.normalize("prod_deployment", "NA").category == "not_required"
    assert n.normalize("prod_required", "Yes").category == "yes"
    assert n.normalize("work_type", "Bug investigation").category == "analysis"
    assert n.normalize("work_type", "Onboarding / Development").category == "development"


def test_status_normalizer_add_mapping_persists(tmp_path: Path):
    path = tmp_path / "cfg.json"
    n = StatusNormalizer(path)
    n.normalize("work_status", "Galactic")
    n.add_mapping("work_status", "in_progress", "Galactic")
    assert n.normalize("work_status", "Galactic").category == "in_progress"
    assert "Galactic" not in n.unmapped_values()["work_status"]
    n2 = StatusNormalizer(path)
    assert n2.normalize("work_status", "galactic").category == "in_progress"
    n2.reset()
    assert n2.normalize("work_status", "Galactic").category == "other"


# ---------------------------------------------------------------- template parser
def test_template_parser_on_sample(sample_data_dir: Path):
    p = TemplateParser()
    rep = p.parse(read_workbook(sample_data_dir / "EmpA" / "Alice_A-15-10-2026.xlsx"))
    assert rep.layout == "template"
    assert rep.metadata.employee == "Alice A" and rep.metadata.project == "Project X"
    assert rep.metadata.jira_board == "ALPHA Board" and rep.metadata.team_lead == "Lead Person"
    assert rep.metadata.report_date == date(2026, 10, 15) and rep.metadata.report_date_source == "cell"
    assert len(rep.work_items) == 4
    assert rep.work_items[0]["ticket_ids"] == ["A-1"]
    assert rep.work_items[3]["ticket_ids"] == [] and rep.work_items[3]["ticket_note"] == "no jira reference"
    assert rep.metadata.notes == ["Helped onboarding."]
    assert any(i.category == "missing_ticket" for i in rep.issues)

    rep2 = p.parse(read_workbook(sample_data_dir / "EmpA" / "Alice_A-30-10-2026.xlsx"))
    assert len(rep2.work_items) == 3 and rep2.work_items[1]["ticket_ids"] == ["A-4", "A-5"]
    assert len(rep2.releases) == 2
    assert rep2.releases[0]["release_date_parsed"] == date(2026, 10, 29)
    assert rep2.releases[1]["release_date_parsed"] is None


def test_template_parser_invalid_date_and_duplicates(sample_data_dir: Path):
    rep = TemplateParser().parse(read_workbook(sample_data_dir / "EmpB" / "Bob_B-16-10-2026.xlsx"))
    assert rep.metadata.report_date == date(2026, 10, 16) and rep.metadata.report_date_source == "filename"
    assert any(i.category == "report_date" for i in rep.issues)
    assert rep.work_mapping and rep.work_mapping.headers[1] == "Jira/OS Ticket ID"


def test_flat_layout_and_employee_from_folder(sample_data_dir: Path):
    path = sample_data_dir / "Carol_C" / "CarolC- Work Update - 15-10-2026.xlsx"
    rep = TemplateParser().parse(read_workbook(path))
    assert rep.layout == "flat"
    assert rep.metadata.employee == "Carol C" and rep.metadata.employee_source == "folder"
    assert rep.metadata.report_date == date(2026, 10, 15)
    assert len(rep.work_items) == 2
    assert employee_from_path(Path("Data/Rohit_Jana/x.xlsx")) == ("Rohit Jana", "folder")
    assert employee_from_path(Path("uploads/Rohit_Bhaskar-30-10-2026.xlsx"))[0] == "Rohit Bhaskar"


def test_empty_workbook_is_reported_not_crashed(sample_data_dir: Path):
    rep = TemplateParser().parse(read_workbook(sample_data_dir / "EmpD" / "Dan_D-16-10-2026.xlsx"))
    assert rep.layout == "unknown"
    assert any(i.category == "empty_workbook" for i in rep.issues)
    assert rep.metadata.employee == "Emp D"


def test_sheet_detection(sample_data_dir: Path):
    assert list_sheet_names(sample_data_dir / "EmpA" / "Alice_A-15-10-2026.xlsx") == ["Bi-Weekly Work Update"]
    assert list_sheet_names(sample_data_dir / "Carol_C" / "CarolC- Work Update - 15-10-2026.xlsx") == ["Sheet1"]
