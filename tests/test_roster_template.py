from subject_teacher.roster_template import save_template
from subject_teacher.gui.api import _read_xlsx_rows, _students_from_rows
from subject_teacher.mixed_service import preview_rows


def test_regular_template_round_trips_through_actual_importer(tmp_path):
    path = tmp_path / "regular.xlsx"
    save_template(path)
    rows = _students_from_rows(_read_xlsx_rows(path))
    assert len(rows) == 3
    assert rows[0]["n"] == 1


def test_mixed_template_round_trips_through_actual_importer(tmp_path):
    path = tmp_path / "mixed.xlsx"
    save_template(path, True)
    rows = preview_rows(_read_xlsx_rows(path), 2)
    assert len(rows) == 3
    assert rows[2]["homeClassNo"] == "2"
