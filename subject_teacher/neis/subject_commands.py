"""Low-level Selenium helpers for NEIS subject attendance screens."""
from __future__ import annotations

import json
import re
import time
from datetime import date as date_type
from typing import Iterable

from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

import utils

MENU_PATH = [
    "\uad50\uacfc\ub2f4\uc784",
    "\ud559\uc801",
    "\ucd9c\uacb0\uad00\ub9ac",
]

SIDE_MENU_LABEL = "\uacfc\ubaa9\ubcc4\ucd9c\uacb0\uad00\ub9ac"
SAVE_CONFIRM_TEXT = "\ud574\ub2f9\uc790\ub8cc\ub97c \uc800\uc7a5\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?"
SAVE_CONFIRM_OK_TEXT = "\ud655\uc778"
SAVE_NO_CHANGE_TEXT = "\ubcc0\uacbd\ub41c \ub0b4\uc6a9\uc774 \uc5c6\uc2b5\ub2c8\ub2e4."
CLOSE_CONFIRM_TEXTS = [
    "\ucd9c\uacb0\ub9c8\uac10",
    "\ub9c8\uac10\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c",
    "\ub9c8\uac10\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?",
    "\ub9c8\uac10 \ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c",
    "\ub9c8\uac10 \ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?",
]
CLOSE_NOTICE_TEXTS = [
    "\ub9c8\uac10\ub418\uc5c8\uc2b5\ub2c8\ub2e4",
    "\ub9c8\uac10\ud588\uc2b5\ub2c8\ub2e4",
    "\ub9c8\uac10\ud558\uc600\uc2b5\ub2c8\ub2e4",
]

SEL: dict[str, str] = {
    "radio_day_mode": "//div[@data-role='radio' and @data-value='1']",
    "radio_subject_mode": "//div[@data-role='radio' and @data-value='2']",
    "input_date": "//input[contains(@aria-label, '\uc77c\uc790')]",
    "left_panel_period_row": "//*[contains(@aria-label, '\uad50\uc2dc {period}')]",
    "excused_checkbox": "//div[@role='checkbox' and contains(@aria-label, '출석인정')]",
    "student_row_by_number": "//table[contains(@class,'attend-grid')]//tr[td[normalize-space()='{number}']]",
    "cell_status_in_row": ".//td[contains(@class,'status')]//input",
    "cell_note_in_row": ".//td[contains(@class,'note')]//input",
}

DATE_INPUT_XPATHS = [
    "//input[contains(@aria-label, '\uc77c\uc790')]",
    "//input[contains(@title, '\uc77c\uc790')]",
    "//input[contains(@placeholder, '\uc77c\uc790')]",
    "//input[contains(@id, 'date') or contains(@name, 'date') or @type='date']",
    "//div[contains(@class, 'cl-dateinput')]//input",
]


def build_student_row_xpath(student_number: int) -> str:
    return (
        f"//div[@role='row']["
        f".//div[@data-cellindex='4' and .//*[normalize-space()='{student_number}']]"
        f" and .//div[@data-cellindex='5']"
        f" and .//div[@data-cellindex='7' and contains(@aria-label, '\ucd9c\uc11d\uc0c1\ud0dc')]"
        f"]"
    )


def build_status_cell_xpath(student_number: int) -> str:
    row_xpath = build_student_row_xpath(student_number)
    return (
        f"{row_xpath}//div[@role='gridcell' and (@data-cellindex='7' or @data-cellindex='8' or @data-cellindex='9')][1]"
    )


def build_note_input_xpath(student_number: int) -> str:
    row_xpath = build_student_row_xpath(student_number)
    return f"{row_xpath}//div[@role='gridcell' and @data-cellindex='12']//input"


def build_side_menu_xpath() -> str:
    label = SIDE_MENU_LABEL
    return (
        f"//a[contains(@class,'cl-sidenavigation-item') and contains(normalize-space(.), '{label}')]"
        f"|//div[contains(@class,'cl-sidenavigation-item') and contains(normalize-space(.), '{label}')]"
    )


def build_button_xpath(label: str) -> str:
    return (
        f"//div[@role='button' and @aria-label='{label}']"
        f"|//a[contains(@class,'cl-text-wrapper')][.//div[contains(@class,'cl-text') and normalize-space()='{label}']]"
        f"|//div[contains(@class,'cl-button') and .//div[contains(@class,'cl-text') and normalize-space()='{label}']]"
    )


def build_date_input_xpath() -> str:
    return "|".join(DATE_INPUT_XPATHS)


def build_date_step_button_xpath(direction: str) -> str:
    label = "일자더하기" if direction == "plus" else "일자빼기"
    return f"//div[@role='button' and @aria-label='{label}']"


def _xpath_literal(value: str) -> str:
    if "'" not in value:
        return f"'{value}'"
    if '"' not in value:
        return f'"{value}"'
    return "concat(" + ", \"'\", ".join(f"'{part}'" for part in value.split("'")) + ")"


def _period_subject_needles(subject_label: str | None) -> list[str]:
    if not subject_label:
        return []
    text = subject_label.strip()
    if not text:
        return []

    needles = [text]
    match = re.search(r"\(([^)]+)\)", text)
    if match:
        needles.append(match.group(1).strip())
    else:
        before_dash = re.split(r"\s+-\s+|/", text, maxsplit=1)[0].strip()
        if before_dash:
            needles.append(before_dash)

    tokens = re.findall(r"[0-9]+학년|[0-9]+반|[A-Za-z가-힣ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[A-Za-z가-힣ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ0-9]*", text)
    needles.extend(token for token in tokens if not token.isdigit())

    deduped: list[str] = []
    for needle in needles:
        needle = needle.strip()
        if needle and needle not in deduped:
            deduped.append(needle)
    return deduped


def build_period_row_xpath(period: int, subject_label: str | None = None) -> str:
    labels = [f"{period}교시", f"{period} 교시", f"교시 {period}"]
    parts = []
    subject_checks = ""
    if subject_label:
        subject_parts = []
        for needle in _period_subject_needles(subject_label):
            literal = _xpath_literal(needle)
            subject_parts.append(f"contains(@aria-label, {literal}) or contains(normalize-space(.), {literal})")
        if subject_parts:
            subject_checks = " and (" + " or ".join(subject_parts) + ")"

    for label in labels:
        parts.extend(
            [
                f"//*[@role='row' and (contains(@aria-label, '{label}') or contains(normalize-space(.), '{label}')){subject_checks}]",
                f"//*[contains(@aria-label, '{label}') and not(self::script) and not(self::style){subject_checks}]",
                f"//*[contains(normalize-space(.), '{label}') and not(self::script) and not(self::style){subject_checks}]",
            ]
        )
    return "|".join(parts)


def normalize_neis_date(date_str: str) -> str:
    return date_str.replace("-", ".")


def format_neis_date_label(date_str: str) -> str:
    text = date_str.strip()
    if "(" in text and ")" in text:
        return text.replace("-", ".")

    normalized = normalize_neis_date(text).rstrip(".")
    iso_date = normalized.replace(".", "-")
    weekday = "월화수목금토일"[date_type.fromisoformat(iso_date).weekday()]
    return f"{normalized}.({weekday})"


def parse_neis_date_label(value: str) -> date_type:
    text = value.strip().replace("-", ".")
    date_part = text.split("(", 1)[0].rstrip(".")
    return date_type.fromisoformat(date_part.replace(".", "-"))


def date_option_prefix(date_str: str) -> str:
    return format_neis_date_label(date_str).split("(", 1)[0].rstrip(".")


def date_option_matches(option_text: str, date_str: str) -> bool:
    normalized = " ".join(option_text.replace("-", ".").split())
    return normalized.startswith(date_option_prefix(date_str))


def combo_already_selected(aria_labels: Iterable[str], label_text: str, option_text: str) -> bool:
    expected = f"{label_text}, {option_text}"
    return any((label or "").strip() == expected for label in aria_labels)


def _wait(driver: WebDriver, timeout: float = 10.0) -> WebDriverWait:
    return WebDriverWait(driver, timeout)


def _find_visible_date_input(driver: WebDriver):
    script = """
    const candidates = Array.from(document.querySelectorAll([
      "input[aria-label*='일자']",
      "input[title*='일자']",
      "input[placeholder*='일자']",
      "input[type='date']",
      ".cl-dateinput input"
    ].join(",")));
    return candidates.find((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !el.disabled;
    }) || null;
    """
    return _wait(driver).until(lambda d: d.execute_script(script))


def _visible_date_value(driver: WebDriver) -> str:
    date_input = _find_visible_date_input(driver)
    return (date_input.get_attribute("value") or "").strip()


def _date_value_matches(driver: WebDriver, target_day: date_type) -> bool:
    try:
        return parse_neis_date_label(_visible_date_value(driver)) == target_day
    except Exception:
        return False


def _click_like_user(driver: WebDriver, element) -> None:
    driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'center'});", element)
    try:
        element.click()
        return
    except Exception:
        pass
    driver.execute_script(
        """
        const el = arguments[0];
        const rect = el.getBoundingClientRect();
        const opts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        };
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.dispatchEvent(new MouseEvent("click", opts));
        """,
        element,
    )


def _click_matching_date_option(driver: WebDriver, date_str: str) -> bool:
    return bool(
        driver.execute_script(
            """
            const prefix = arguments[0];
            const normalize = (value) => (value || "").replace(/-/g, ".").replace(/\\s+/g, " ").trim();
            const isVisible = (el) => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden";
            };
            const options = Array.from(document.querySelectorAll([
              "[role='option']",
              "div.cl-combobox-item",
              ".cl-listbox-item",
              ".cl-listitem"
            ].join(","))).filter(isVisible);
            const option = options.find((el) => normalize(el.innerText || el.textContent).startsWith(prefix));
            if (!option) return false;
            option.scrollIntoView({block: "center", inline: "center"});
            const rect = option.getBoundingClientRect();
            const opts = {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
            };
            option.dispatchEvent(new MouseEvent("mousedown", opts));
            option.dispatchEvent(new MouseEvent("mouseup", opts));
            option.dispatchEvent(new MouseEvent("click", opts));
            return true;
            """,
            date_option_prefix(date_str),
        )
    )


def _date_combobox_button(driver: WebDriver, date_input):
    return driver.execute_script(
        """
        const combo = arguments[0].closest(".cl-combobox");
        if (!combo) return null;
        const button = combo.querySelector(".cl-combobox-button");
        return button || combo;
        """,
        date_input,
    )


def _type_date_and_commit(driver: WebDriver, date_input, date_str: str) -> None:
    target_prefix = date_option_prefix(date_str)
    _click_like_user(driver, date_input)
    date_input.send_keys(Keys.CONTROL, "a")
    date_input.send_keys(target_prefix)
    time.sleep(0.2)
    if _click_matching_date_option(driver, date_str):
        return
    date_input.send_keys(Keys.ENTER)
    date_input.send_keys(Keys.TAB)


def _dump_date_debug(driver: WebDriver, date_str: str) -> None:
    debug_script = """
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    };
    const shape = (el) => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        id: el.id || "",
        name: el.getAttribute("name") || "",
        type: el.getAttribute("type") || "",
        cls: String(el.className || ""),
        role: el.getAttribute("role") || "",
        aria: el.getAttribute("aria-label") || "",
        title: el.getAttribute("title") || "",
        placeholder: el.getAttribute("placeholder") || "",
        value: el.value || "",
        text: (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200),
        visible: isVisible(el),
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
        html: (el.outerHTML || "").slice(0, 500),
      };
    };
    return {
      target: arguments[0],
      activeElement: document.activeElement ? shape(document.activeElement) : null,
      inputs: Array.from(document.querySelectorAll("input")).map(shape),
      combos: Array.from(document.querySelectorAll(".cl-combobox")).map(shape),
      dateButtons: Array.from(document.querySelectorAll("[aria-label*='일자']")).map(shape),
      options: Array.from(document.querySelectorAll("[role='option'], div.cl-combobox-item, .cl-listbox-item, .cl-listitem")).map(shape),
    };
    """
    with open("tmp_neis_date_inputs.json", "w", encoding="utf-8") as f:
        json.dump(
            driver.execute_script(debug_script, format_neis_date_label(date_str)),
            f,
            ensure_ascii=False,
            indent=2,
        )


def open_subject_attendance_page(driver: WebDriver, year: int, term: int) -> None:
    utils.neis_go_menu(driver, *MENU_PATH)
    side_menu = _wait(driver, 15).until(
        EC.element_to_be_clickable((By.XPATH, build_side_menu_xpath()))
    )
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", side_menu)
    driver.execute_script("arguments[0].click();", side_menu)

    # The page defaults to the active school year/term and the legacy combobox helper
    # is brittle against duplicate hidden controls. For the current workflow we rely on
    # the already-selected values and only automate date/mode/period interactions.


def select_day_mode(driver: WebDriver) -> None:
    _wait(driver).until(EC.element_to_be_clickable((By.XPATH, SEL["radio_day_mode"]))).click()


def select_date(driver: WebDriver, date_str: str) -> None:
    target_date = format_neis_date_label(date_str)
    target_day = parse_neis_date_label(target_date)
    try:
        date_input = _find_visible_date_input(driver)
        if _date_value_matches(driver, target_day):
            return

        _type_date_and_commit(driver, date_input, date_str)
        try:
            _wait(driver, 3).until(lambda d: _date_value_matches(d, target_day))
            return
        except Exception:
            pass

        date_input = _find_visible_date_input(driver)
        combo_button = _date_combobox_button(driver, date_input)
        if combo_button is not None:
            _click_like_user(driver, combo_button)
            time.sleep(0.3)
            if _click_matching_date_option(driver, date_str):
                try:
                    _wait(driver, 3).until(lambda d: _date_value_matches(d, target_day))
                    return
                except Exception:
                    pass

        # Last resort: set the visible text input and fire the events that NEIS/Cleopatra
        # listens to. This is weaker than selecting an option, but produces a useful state
        # for diagnostics if the custom combobox refuses to expose its option list.
        date_input = _find_visible_date_input(driver)
        try:
            _click_like_user(driver, date_input)
            date_input.send_keys(Keys.CONTROL, "a")
            date_input.send_keys(target_date)
            date_input.send_keys(Keys.ENTER)
            date_input.send_keys(Keys.TAB)
        except Exception:
            pass
        driver.execute_script(
            """
            const el = arguments[0];
            const value = arguments[1];
            const proto = Object.getPrototypeOf(el);
            const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
            el.focus();
            if (descriptor && descriptor.set) {
              descriptor.set.call(el, value);
            } else {
              el.value = value;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
            el.blur();
            """,
            date_input,
            target_date,
        )
        try:
            _wait(driver, 2).until(lambda d: _date_value_matches(d, target_day))
            return
        except Exception:
            actual = _visible_date_value(driver)
            raise RuntimeError(f"date combobox value mismatch: expected {target_date!r}, got {actual!r}")
    except Exception:
        _dump_date_debug(driver, date_str)
        raise


def click_search(driver: WebDriver) -> None:
    button = _wait(driver).until(EC.presence_of_element_located((By.XPATH, build_button_xpath("\uc870\ud68c"))))
    driver.execute_script("arguments[0].click();", button)


def page_has_period_rows(driver: WebDriver) -> bool:
    return bool(
        driver.find_elements(
            By.XPATH,
            "//*[contains(@aria-label, '교시') or contains(normalize-space(.), '교시')]",
        )
    )


def _click_period_row_by_text(
    driver: WebDriver,
    period: int,
    subject_label: str | None,
    grade: int | None = None,
    class_no: str | None = None,
) -> bool:
    target = driver.execute_script(
        """
        const period = String(arguments[0]);
        const subjectNeedles = arguments[1] || [];
        const grade = arguments[2] == null ? "" : String(arguments[2]);
        const classNo = arguments[3] == null ? "" : String(arguments[3]);
        const normalize = (value) => (value || "").replace(/\\s+/g, "").trim();
        const isVisible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden";
        };
        const textOf = (el) => normalize(
          `${el.innerText || el.textContent || ""} ${el.getAttribute("aria-label") || ""}`
        );
        const cellText = (cell) => normalize(
          `${cell?.innerText || cell?.textContent || ""} ${cell?.getAttribute("aria-label") || ""}`
        );
        const hasPeriod = (row) => {
          const firstCell = row.querySelector("[data-cellindex='0'], [data-cellindex='1'], [aria-label*='교시']");
          const text = cellText(firstCell || row);
          return text.includes(`교시${period}`) || text === period || text.includes(`${period}교시`);
        };
        const hasSubject = (text) =>
          !subjectNeedles.length || subjectNeedles.some((needle) => text.includes(normalize(needle)));
        const hasClass = (text) =>
          !grade || !classNo ||
          text.includes(`${grade}학년${classNo}`) ||
          text.includes(`${grade}-${classNo}`) ||
          text.includes(`${grade}학년${classNo}반`);
        const rowMatches = (row) => {
          const text = textOf(row);
          return hasPeriod(row) && hasSubject(text) && hasClass(text);
        };
        const score = (row) => {
          const text = textOf(row);
          if (!hasSubject(text)) return 0;
          if (grade && classNo && !hasClass(text)) return 0;
          const rect = row.getBoundingClientRect();
          let value = rowMatches(row) ? 2000 : 0;
          if (hasPeriod(row)) value += 500;
          if (hasClass(text)) value += 400;
          value += Math.max(0, 200 - Math.min(200, rect.width * rect.height / 100));
          return value;
        };
        const periodGrids = Array.from(document.querySelectorAll("[role='grid'], .cl-grid"))
          .filter(isVisible)
          .filter((grid) => {
            const text = textOf(grid);
            const aria = grid.getAttribute("aria-label") || "";
            return text.includes("교시") && text.includes("과목") &&
              (aria.includes("출결일자목록") || !text.includes("성명"));
          });
        const searchRoots = periodGrids.length ? periodGrids : [document];
        const candidates = searchRoots.flatMap((root) =>
          Array.from(root.querySelectorAll("[role='row'], .cl-grid-row"))
        ).filter(isVisible);
        const ranked = candidates
          .map((el) => ({ el, value: score(el) }))
          .filter((item) => item.value > 0)
          .sort((a, b) => b.value - a.value);
        if (!ranked.length) return null;
        const row = ranked[0].el;
        return row.querySelector("[data-cellindex='2']") ||
          row.querySelector("[data-cellindex='1']") ||
          row;
        """,
        period,
        _period_subject_needles(subject_label),
        grade,
        str(class_no) if class_no is not None else None,
    )
    if not target:
        return False
    _click_grid_cell(driver, target)
    return True


def _student_grid_ready(driver: WebDriver) -> bool:
    return bool(
        driver.execute_script(
            """
            const isVisible = (el) => {
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden";
            };
            const cellText = (cell) => (cell?.innerText || cell?.textContent || "")
              .replace(/\\s+/g, " ")
              .trim();
            const rows = Array.from(document.querySelectorAll("[role='row'], .cl-grid-row")).filter(isVisible);
            for (const row of rows) {
              const numberCell = row.querySelector("[data-cellindex='4']");
              const nameCell = row.querySelector("[data-cellindex='5']");
              const statusCell = row.querySelector("[data-cellindex='7']");
              if (!isVisible(numberCell) || !isVisible(nameCell) || !isVisible(statusCell)) continue;
              if (/^\\d+$/.test(cellText(numberCell))) return true;
            }
            return false;
            """
        )
    )


def _wait_for_student_grid_ready(
    driver: WebDriver,
    period: int,
    subject_label: str | None = None,
    grade: int | None = None,
    class_no: str | None = None,
) -> None:
    try:
        _wait(driver, 6).until(lambda current: _student_grid_ready(current))
    except Exception as exc:
        label = subject_label or ""
        class_text = f"{grade}학년 {class_no}반 " if grade is not None and class_no is not None else ""
        raise RuntimeError(
            f"period selected but student grid did not load: {class_text}{period}교시 {label}".strip()
        ) from exc


def select_period(
    driver: WebDriver,
    period: int,
    subject_label: str | None = None,
    grade: int | None = None,
    class_no: str | None = None,
) -> None:
    xpath = build_period_row_xpath(period, subject_label)
    try:
        # The period list refreshes after a date change; matching too early (before
        # the rows for the new date exist) intermittently fails. Wait for period rows
        # to be present, then retry the fast/reliable JS text match for a few seconds
        # before falling back to the slower XPath wait.
        try:
            _wait(driver, 10).until(lambda d: page_has_period_rows(d))
        except Exception:
            pass
        deadline = time.time() + 6
        while time.time() < deadline:
            if _click_period_row_by_text(driver, period, subject_label, grade, class_no):
                _wait_for_student_grid_ready(driver, period, subject_label, grade, class_no)
                return
            time.sleep(0.4)

        row = _wait(driver, 15).until(EC.presence_of_element_located((By.XPATH, xpath)))
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", row)
        _click_like_user(driver, row)
        _wait_for_student_grid_ready(driver, period, subject_label, grade, class_no)
    except Exception:
        debug_script = """
        const period = String(arguments[0]);
        const subjectNeedles = arguments[1] || [];
        const out = [];
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
          const aria = el.getAttribute('aria-label') || '';
          const subjectHit = subjectNeedles.some((needle) => text.includes(needle) || aria.includes(needle));
          if (text.includes('교시') || aria.includes('교시') || text.includes(period) || aria.includes(period) || subjectHit) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            out.push({
              tag: el.tagName,
              cls: String(el.className || ''),
              role: el.getAttribute('role') || '',
              aria,
              text: text.slice(0, 200),
              x: rect.left,
              y: rect.top,
              w: rect.width,
              h: rect.height,
              html: (el.outerHTML || '').slice(0, 500),
            });
          }
        }
        return out.slice(0, 200);
        """
        with open("tmp_neis_period_candidates.json", "w", encoding="utf-8") as f:
            json.dump(
                {
                    "target": {
                        "period": period,
                        "subjectLabel": subject_label or "",
                        "subjectNeedles": _period_subject_needles(subject_label),
                    },
                    "candidates": driver.execute_script(
                        debug_script,
                        period,
                        _period_subject_needles(subject_label),
                    ),
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
        raise


def ensure_excused_mode(driver: WebDriver, on: bool) -> None:
    """Turn the NEIS '출석인정' checkbox on/off so the next cell click writes Ø vs /.

    The control is a <div role="checkbox" aria-checked="..."> (eXBuilder6), NOT a
    native <input>, so Selenium's is_selected() always reports False. Read the real
    state from aria-checked, click only when it differs, and confirm the flip
    (re-finding the element each time to survive grid re-renders).

    Turning it ON raises if it cannot be confirmed (we must be ON to mark Ø).
    Turning it OFF is hygiene for the next slot and is best-effort — it must never
    raise, or it would abort the slot before 저장(click_save) runs.
    """

    def find():
        elements = driver.find_elements(By.XPATH, SEL["excused_checkbox"])
        return elements[0] if elements else None

    def is_on() -> bool:
        element = find()
        return element is not None and (element.get_attribute("aria-checked") or "").lower() == "true"

    if find() is None:
        if on:
            raise RuntimeError("'출석인정' 체크박스를 찾을 수 없습니다")
        return

    for _ in range(3):
        if is_on() == on:
            return
        element = find()
        if element is None:
            break
        driver.execute_script("arguments[0].click();", element)
        deadline = time.time() + 1.5
        while time.time() < deadline:
            if is_on() == on:
                return
            time.sleep(0.1)

    # Could not confirm the desired state.
    if on and is_on() != on:
        raise RuntimeError("'출석인정' 체크박스를 켜지 못했습니다")
    # on=False (or already settled): never raise — let 저장 proceed.


def click_reset(driver: WebDriver) -> None:
    button = _wait(driver).until(EC.presence_of_element_located((By.XPATH, build_button_xpath("\ucd08\uae30\ud654"))))
    driver.execute_script("arguments[0].click();", button)


def _click_grid_cell(driver: WebDriver, cell) -> None:
    driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'center'});", cell)
    target = cell
    try:
        fields = cell.find_elements(By.CSS_SELECTOR, "input, textarea")
        if fields:
            target = fields[0]
    except Exception:
        target = cell

    try:
        point = driver.execute_script(
            """
            const target = arguments[0];
            const rect = target.getBoundingClientRect();
            return {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            };
            """,
            target,
        )
        driver.execute_cdp_cmd(
            "Input.dispatchMouseEvent",
            {"type": "mousePressed", "x": point["x"], "y": point["y"], "button": "left", "clickCount": 1},
        )
        driver.execute_cdp_cmd(
            "Input.dispatchMouseEvent",
            {"type": "mouseReleased", "x": point["x"], "y": point["y"], "button": "left", "clickCount": 1},
        )
        return
    except Exception:
        pass

    driver.execute_script(
        """
        const target = arguments[0];
        const rect = target.getBoundingClientRect();
        const opts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        };
        target.dispatchEvent(new PointerEvent("pointerdown", opts));
        target.dispatchEvent(new MouseEvent("mousedown", opts));
        target.dispatchEvent(new PointerEvent("pointerup", opts));
        target.dispatchEvent(new MouseEvent("mouseup", opts));
        target.dispatchEvent(new MouseEvent("click", opts));
        """,
        target,
    )


def _student_status_cell(driver: WebDriver, student_number: int):
    script = """
    const studentNumber = String(arguments[0]);
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    };
    const cellText = (el) => (el.innerText || el.textContent || "")
      .replace(/\\s+/g, " ")
      .trim();
    const numberMatches = (cell) => {
      const aria = cell.getAttribute("aria-label") || "";
      const text = cellText(cell);
      if (aria.includes(`번호 ${studentNumber}`)) return true;
      return text.split(" ").includes(studentNumber) && aria.includes("번호");
    };
    const rows = Array.from(document.querySelectorAll("[role='row'], .cl-grid-row")).filter(isVisible);
    for (const row of rows) {
      const numberCell = row.querySelector("[data-cellindex='4']");
      const nameCell = row.querySelector("[data-cellindex='5']");
      const statusCell = row.querySelector("[data-cellindex='7']");
      if (!numberCell || !nameCell || !statusCell) continue;
      const statusAria = statusCell.getAttribute("aria-label") || "";
      if (!statusAria.includes("출석상태")) continue;
      if (!numberMatches(numberCell)) continue;
      return statusCell;
    }
    return null;
    """
    return driver.execute_script(script, student_number)


def _status_cell_has_absent_mark(driver: WebDriver, cell) -> bool:
    script = """
    const cell = arguments[0];
    if (!cell) return false;
    const values = [
      cell.innerText || "",
      cell.textContent || "",
      cell.getAttribute("aria-label") || "",
      cell.getAttribute("title") || "",
    ];
    for (const input of Array.from(cell.querySelectorAll("input, textarea"))) {
      values.push(input.value || "");
      values.push(input.getAttribute("value") || "");
      values.push(input.getAttribute("aria-label") || "");
      values.push(input.getAttribute("title") || "");
    }
    // '/' = 결과, 'Ø' = 인정결과. 담임이 둘 중 무엇으로든 찍어둔 경우를 모두 잡는다.
    const joined = values.join(" ");
    return joined.includes("/") || joined.includes("Ø");
    """
    return bool(driver.execute_script(script, cell))


def _student_row_has_absent_mark(driver: WebDriver, student_number: int) -> bool:
    script = """
    const studentNumber = String(arguments[0]);
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    };
    const textOf = (el) => {
      const values = [
        el.innerText || "",
        el.textContent || "",
        el.getAttribute("aria-label") || "",
        el.getAttribute("title") || "",
      ];
      for (const input of Array.from(el.querySelectorAll("input, textarea"))) {
        values.push(input.value || "");
        values.push(input.getAttribute("value") || "");
        values.push(input.getAttribute("aria-label") || "");
        values.push(input.getAttribute("title") || "");
      }
      return values.join(" ").replace(/\\s+/g, " ").trim();
    };
    const numberMatches = (cell) => {
      const aria = cell.getAttribute("aria-label") || "";
      const text = textOf(cell);
      if (aria.includes(`번호 ${studentNumber}`)) return true;
      return text.split(" ").includes(studentNumber) && aria.includes("번호");
    };
    const rows = Array.from(document.querySelectorAll("[role='row'], .cl-grid-row")).filter(isVisible);
    for (const row of rows) {
      const numberCell = row.querySelector("[data-cellindex='4']");
      const nameCell = row.querySelector("[data-cellindex='5']");
      if (!numberCell || !nameCell) continue;
      if (!numberMatches(numberCell)) continue;
      const statusCells = Array.from(row.querySelectorAll("[data-cellindex='7']"));
      return statusCells.some((cell) => textOf(cell).includes("/"));
    }
    return false;
    """
    return bool(driver.execute_script(script, student_number))


def _wait_for_absent_mark(driver: WebDriver, student_number: int) -> None:
    try:
        _wait(driver, 2).until(lambda d: _student_row_has_absent_mark(d, student_number))
    except Exception as exc:
        raise RuntimeError(f"attendance mark '/' not applied for student {student_number}") from exc


def click_attendance_cell(driver: WebDriver, student_number: int, expected_mark: str | None = None) -> bool:
    """Mark a student's attendance cell.

    Returns True when a new mark was applied, False when skipped because the cell
    already carries a mark — the homeroom teacher's '/' (결과) or 'Ø' (인정결과).
    Those must be preserved, not overwritten/toggled off.
    """
    try:
        cell = _wait(driver).until(lambda d: _student_status_cell(d, student_number))
    except Exception:
        cell = None

    if cell is not None:
        if _status_cell_has_absent_mark(driver, cell):
            return False  # 담임이 이미 표시(/ 또는 Ø) → 건너뛰기
        _click_grid_cell(driver, cell)
        time.sleep(0.2)
        if expected_mark == "absent":
            _wait_for_absent_mark(driver, student_number)
        return True

    script = """
    const studentNumber = String(arguments[0]);
    const expectedMark = arguments[1];
    const cellHasSlash = (cell) => {
      const values = [
        cell.innerText || '',
        cell.textContent || '',
        cell.getAttribute('aria-label') || '',
        cell.getAttribute('title') || '',
      ];
      for (const input of Array.from(cell.querySelectorAll('input, textarea'))) {
        values.push(input.value || '');
        values.push(input.getAttribute('value') || '');
        values.push(input.getAttribute('aria-label') || '');
        values.push(input.getAttribute('title') || '');
      }
      const j = values.join(' ');
      return j.includes('/') || j.includes('Ø');
    };
    const candidates = Array.from(document.querySelectorAll('*')).filter((el) => {
      const text = (el.innerText || '').trim();
      const aria = el.getAttribute('aria-label') || '';
      const compact = text.replace(/\\s+/g, ' ').trim();
      const isShort = compact.length > 0 && compact.length <= 20;
      return (
        text === studentNumber ||
        (isShort && compact.split(' ').includes(studentNumber)) ||
        aria.includes(`번호 ${studentNumber}`) ||
        aria.endsWith(` ${studentNumber}`)
      );
    });
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return (ra.width * ra.height) - (rb.width * rb.height);
    });
    for (const el of candidates) {
      const row = el.closest("[role='row'], .cl-grid-row");
      if (!row) continue;
      const numberCell = row.querySelector("[data-cellindex='4']");
      const nameCell = row.querySelector("[data-cellindex='5']");
      const statusCell = row.querySelector("[data-cellindex='7']");
      if (!numberCell || !nameCell || !statusCell) continue;
      const numberText = (numberCell.innerText || numberCell.textContent || '').replace(/\\s+/g, ' ').trim();
      const numberAria = numberCell.getAttribute("aria-label") || "";
      const statusAria = statusCell.getAttribute("aria-label") || "";
      const numberMatches = numberAria.includes(`번호 ${studentNumber}`) ||
        (numberText.split(" ").includes(studentNumber) && numberAria.includes("번호"));
      if (!numberMatches || !statusAria.includes("출석상태")) continue;
      if (statusCell) {
        if (cellHasSlash(statusCell)) return 'skipped';
        statusCell.scrollIntoView({block: "center", inline: "center"});
        const rect = statusCell.getBoundingClientRect();
        const opts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        };
        statusCell.dispatchEvent(new PointerEvent("pointerdown", opts));
        statusCell.dispatchEvent(new MouseEvent("mousedown", opts));
        statusCell.dispatchEvent(new PointerEvent("pointerup", opts));
        statusCell.dispatchEvent(new MouseEvent("mouseup", opts));
        statusCell.dispatchEvent(new MouseEvent("click", opts));
        return 'clicked';
      }
    }
    return false;
    """
    outcome = driver.execute_script(script, student_number, expected_mark)
    if not outcome:
        debug_script = """
        const studentNumber = String(arguments[0]);
        const out = [];
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const text = (el.innerText || '').trim();
          const aria = el.getAttribute('aria-label') || '';
          if (text.includes(studentNumber) || aria.includes(studentNumber)) {
            const rect = el.getBoundingClientRect();
            out.push({
              tag: el.tagName,
              cls: el.className,
              role: el.getAttribute('role'),
              aria,
              text,
              x: rect.left,
              y: rect.top,
              w: rect.width,
              h: rect.height,
              html: (el.outerHTML || '').slice(0, 500),
            });
          }
        }
        return out;
        """
        with open("tmp_student_candidates.json", "w", encoding="utf-8") as f:
            json.dump(driver.execute_script(debug_script, student_number), f, ensure_ascii=False, indent=2)
        raise RuntimeError(f"attendance cell not found for student {student_number}")
    if outcome == "skipped":
        return False  # 담임이 이미 표시(/ 또는 Ø) → 건너뛰기
    if expected_mark == "absent":
        _wait_for_absent_mark(driver, student_number)
    return True


def fill_note(driver: WebDriver, student_number: int, note: str) -> None:
    try:
        field = _wait(driver).until(EC.presence_of_element_located((By.XPATH, build_note_input_xpath(student_number))))
        field.clear()
        field.send_keys(note)
        return
    except Exception:
        pass

    script = """
    const studentNumber = String(arguments[0]);
    const note = arguments[1];
    const row = Array.from(document.querySelectorAll("div[role='row']")).find((el) =>
      el.innerText && el.innerText.split(/\\s+/).includes(studentNumber)
    );
    if (!row) return false;
    const noteCell = row.querySelector("div[data-cellindex='12']");
    if (!noteCell) return false;
    const field = noteCell.querySelector("input, textarea");
    if (!field) return false;
    field.focus();
    field.value = note;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
    """
    if not driver.execute_script(script, student_number, note):
        return


def visible_result_count(driver: WebDriver) -> int | None:
    script = """
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight;
    };
    const textOf = (el) => [
      el.innerText || "",
      el.textContent || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
    ].join(" ").replace(/\\s+/g, " ").trim();
    const candidates = Array.from(document.querySelectorAll("*"))
      .filter(isVisible)
      .map(textOf)
      .filter((text) => text.includes("결과") && text.includes("명"));
    for (const text of candidates) {
      // Read the combined '결과 N명' counter, NOT the '인정결과 N명' sub-counter
      // (which also contains '결과'); otherwise mixed /,Ø days mis-count.
      const match = text.match(/(?<!인정)결과\\s*:?\\s*(\\d+)\\s*명/);
      if (match) return Number(match[1]);
    }
    return null;
    """
    result = driver.execute_script(script)
    return int(result) if result is not None else None


def _dump_result_count_diagnostics(driver: WebDriver, expected: int, actual) -> None:
    try:
        texts = driver.execute_script(
            """
            const out = [];
            for (const el of Array.from(document.querySelectorAll('*'))) {
              const t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
              if (t && t.length <= 40 && t.includes('결과') && t.includes('명')) out.push(t);
            }
            return Array.from(new Set(out)).slice(0, 50);
            """
        )
    except Exception as exc:
        texts = [f"error: {exc}"]
    try:
        with open("tmp_neis_result_count.json", "w", encoding="utf-8") as f:
            json.dump({"expected": expected, "actual": actual, "texts": texts}, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def verify_result_count(driver: WebDriver, expected_count: int) -> None:
    """Best-effort sanity check of NEIS's combined '결과 N명' counter.

    Must NOT raise: a count-reading hiccup (e.g. an unexpected '인정결과' layout)
    previously aborted the slot before 저장 ran, so attendance got marked but never
    saved. On mismatch/not-found we capture tmp_neis_result_count.json for diagnosis
    and continue — the teacher reviews the marks in NEIS anyway.
    """
    actual = None
    try:
        holder = _wait(driver, 3).until(
            lambda d: ((count,) if (count := visible_result_count(d)) is not None else False)
        )
        actual = holder[0]
    except Exception:
        actual = None
    if actual == expected_count:
        return
    _dump_result_count_diagnostics(driver, expected_count, actual)


def _accept_browser_alert(driver: WebDriver, attempts: int = 8, delay: float = 0.1) -> bool:
    for _ in range(attempts):
        try:
            alert = driver.switch_to.alert
            alert.accept()
            return True
        except Exception:
            time.sleep(delay)
    return False


def _dialog_button_for_text(driver: WebDriver, message_texts: list[str], button_text: str = "확인"):
    script = """
    const messageTexts = arguments[0];
    const buttonText = arguments[1];
    const compact = (value) => String(value || "").replace(/\\s+/g, "");
    const compactMessageTexts = messageTexts.map(compact).filter(Boolean);
    const compactButtonText = compact(buttonText);
    const compactCancelText = compact("취소");

    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !el.disabled &&
        el.getAttribute("aria-disabled") !== "true";
    };

    const textOf = (el) => [
      el.innerText || "",
      el.textContent || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      el.value || "",
    ].join(" ").replace(/\\s+/g, " ").trim();

    const textMatches = (el) => {
      const compactText = compact(textOf(el));
      return compactMessageTexts.some((text) => compactText.includes(text));
    };

    const dialogSelector = [
      "[role='dialog']",
      "[role='alertdialog']",
      ".cl-dialog",
      ".cl-popup",
      ".cl-window",
      ".modal-msg"
    ].join(",");
    const dialogs = Array.from(document.querySelectorAll(dialogSelector))
      .filter(isVisible)
      .filter(textMatches)
      .sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return (ra.width * ra.height) - (rb.width * rb.height);
      });
    if (!dialogs.length) return null;
    const scope = dialogs[0];

    const controls = Array.from(scope.querySelectorAll([
      "button",
      "[role='button']",
      ".cl-button",
      ".cl-text-wrapper",
      "[data-role='button']",
      "input[type='button']",
      "input[type='submit']"
    ].join(","))).filter(isVisible)
      // The dialog header/title can also read '확인' (cl-dialog-header > .cl-text).
      // Excluding the header (and dropping the bare .cl-text selector) ensures we
      // click the real action button, not the title bar.
      .filter((el) => !el.closest(".cl-dialog-header"));

    const okButton = controls.find((el) => compact(textOf(el)) === compactButtonText) ||
      controls.find((el) => {
        const text = compact(textOf(el));
        return text.includes(compactButtonText) && !text.includes(compactCancelText);
      });
    if (!okButton) return null;
    const scopeCompactText = compact(textOf(scope));
    const messageText = messageTexts.find((text) => scopeCompactText.includes(compact(text))) || "";
    return { button: okButton, messageText };
    """
    result = driver.execute_script(script, message_texts, button_text)
    return result if isinstance(result, dict) else None


def _click_element_like_user(driver: WebDriver, element) -> None:
    driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'center'});", element)
    try:
        ActionChains(driver).move_to_element(element).click().perform()
        return
    except Exception:
        pass

    driver.execute_script(
        """
        const el = arguments[0];
        const rect = el.getBoundingClientRect();
        const opts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        };
        el.dispatchEvent(new PointerEvent("pointerdown", opts));
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new PointerEvent("pointerup", opts));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.dispatchEvent(new MouseEvent("click", opts));
        """,
        element,
    )


def _save_confirm_visible(driver: WebDriver) -> bool:
    return bool(_dialog_button_for_text(driver, [SAVE_CONFIRM_TEXT], SAVE_CONFIRM_OK_TEXT))


def _wait_for_save_confirm_to_close(driver: WebDriver) -> None:
    for _ in range(20):
        if not _save_confirm_visible(driver):
            return
        time.sleep(0.15)


def _click_neis_save_confirm(driver: WebDriver) -> bool:
    result = _dialog_button_for_text(driver, [SAVE_CONFIRM_TEXT], SAVE_CONFIRM_OK_TEXT)
    if not result:
        return False
    _click_element_like_user(driver, result["button"])
    _wait_for_save_confirm_to_close(driver)
    return True


def _click_neis_close_confirm(driver: WebDriver) -> bool:
    result = _dialog_button_for_text(driver, CLOSE_CONFIRM_TEXTS, SAVE_CONFIRM_OK_TEXT)
    if not result:
        return False
    _click_element_like_user(driver, result["button"])
    return True


def _click_neis_close_notice_ok(driver: WebDriver) -> bool:
    result = _dialog_button_for_text(driver, CLOSE_NOTICE_TEXTS, SAVE_CONFIRM_OK_TEXT)
    if not result:
        return False
    _click_element_like_user(driver, result["button"])
    return True


def _click_neis_save_notice_ok(driver: WebDriver) -> str | None:
    notice_texts = [
        SAVE_NO_CHANGE_TEXT,
        "저장되었습니다",
        "저장 되었습니다",
        "저장했습니다.",
        "저장했습니다",
        "저장하였습니다",
        "저장되었습니다.",
    ]
    result = _dialog_button_for_text(driver, notice_texts, SAVE_CONFIRM_OK_TEXT)
    if not result:
        return None
    _click_element_like_user(driver, result["button"])
    return "no_change" if result.get("messageText") == SAVE_NO_CHANGE_TEXT else "saved"


def _save_completion_snapshot(driver: WebDriver) -> dict:
    script = """
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    };
    const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || "")
      .replace(/\\s+/g, " ")
      .trim();
    const loadingSelectors = [
      ".cl-mask",
      ".cl-loading",
      ".loading",
      "[aria-busy='true']",
      "[role='progressbar']"
    ];
    const loading = loadingSelectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)).filter(isVisible)
    );
    const messages = Array.from(document.querySelectorAll("*"))
      .filter(isVisible)
      .map(textOf)
      .filter((text) => text && text.includes("저장"))
      .slice(0, 30);
    return {
      loadingCount: loading.length,
      messages,
      dialogs: Array.from(document.querySelectorAll("[role='dialog'], [role='alertdialog'], .cl-dialog, .cl-popup, .cl-window"))
        .filter(isVisible)
        .map((el) => textOf(el).slice(0, 200))
        .slice(0, 20),
      buttons: Array.from(document.querySelectorAll("button, [role='button'], .cl-button, .cl-text-wrapper"))
        .filter(isVisible)
        .map((el) => textOf(el).slice(0, 80))
        .filter(Boolean)
        .slice(0, 50),
    };
    """
    result = driver.execute_script(script)
    return result if isinstance(result, dict) else {}


class SaveOverlayNotClosedError(RuntimeError):
    """Do not navigate while a save overlay has an uncertain state."""


def _wait_for_save_completion(driver: WebDriver, *, acknowledged: bool = False) -> str | None:
    started_at = time.monotonic()
    saw_loading = False
    completion_result = None
    for _ in range(40):
        _accept_browser_alert(driver, attempts=1, delay=0)
        notice_result = _click_neis_save_notice_ok(driver)
        if notice_result:
            acknowledged = True
            completion_result = notice_result
        try:
            snapshot = _save_completion_snapshot(driver)
        except Exception:
            time.sleep(0.15)
            continue
        loading_count = snapshot.get("loadingCount", 0)
        if acknowledged:
            # The completion notice has already been accepted. Wait only for
            # its overlay/loading to disappear, not another completion notice.
            if snapshot and loading_count == 0 and not snapshot.get("dialogs"):
                return completion_result
            time.sleep(0.15)
            continue
        if loading_count:
            saw_loading = True
        if loading_count == 0 and time.monotonic() - started_at >= (1.5 if saw_loading else 3.0):
            return None
        time.sleep(0.15)
    _dump_save_diagnostics(driver, "save completion wait timed out")
    if acknowledged:
        raise SaveOverlayNotClosedError("저장 안내가 닫히지 않았습니다. 화면을 확인해 주세요.")
    return None


def _dump_save_diagnostics(driver: WebDriver, reason: str) -> None:
    try:
        snapshot = _save_completion_snapshot(driver)
    except Exception as exc:
        snapshot = {"error": str(exc)}
    with open("tmp_neis_save_dialogs.json", "w", encoding="utf-8") as f:
        json.dump({"reason": reason, "snapshot": snapshot}, f, ensure_ascii=False, indent=2)


def _dump_close_diagnostics(driver: WebDriver, reason: str) -> None:
    try:
        snapshot = _save_completion_snapshot(driver)
    except Exception as exc:
        snapshot = {"error": str(exc)}
    with open("tmp_neis_close_dialogs.json", "w", encoding="utf-8") as f:
        json.dump({"reason": reason, "snapshot": snapshot}, f, ensure_ascii=False, indent=2)


def click_save(driver: WebDriver) -> str | None:
    button = _wait(driver).until(EC.presence_of_element_located((By.XPATH, build_button_xpath("\uc800\uc7a5"))))
    driver.execute_script("arguments[0].click();", button)
    time.sleep(0.2)

    confirmed = _accept_browser_alert(driver, attempts=6, delay=0.1)
    if not confirmed:
        try:
            confirmed = _click_neis_save_confirm(driver)
        except Exception:
            _dump_save_diagnostics(driver, "failed while clicking save confirmation")
            raise

    if not confirmed:
        time.sleep(0.3)

    notice_result = _click_neis_save_notice_ok(driver)
    completion_result = _wait_for_save_completion(driver, acknowledged=bool(notice_result))
    return notice_result or completion_result


def click_close(driver: WebDriver) -> None:
    button = _wait(driver).until(EC.presence_of_element_located((By.XPATH, build_button_xpath("\ucd9c\uacb0\ub9c8\uac10"))))
    driver.execute_script("arguments[0].click();", button)
    time.sleep(0.2)

    confirmed = _accept_browser_alert(driver, attempts=6, delay=0.1)
    if not confirmed:
        try:
            confirmed = _click_neis_close_confirm(driver)
        except Exception:
            _dump_close_diagnostics(driver, "failed while clicking close confirmation")
            raise

    if not confirmed:
        _dump_close_diagnostics(driver, "close confirmation dialog not found")
        raise RuntimeError("NEIS close confirmation dialog not found")

    for _ in range(20):
        if _click_neis_close_notice_ok(driver):
            return
        time.sleep(0.15)


def absent_numbers(absences: Iterable) -> list[int]:
    return [absence.student_number for absence in absences if absence.mark_type.value == "absent"]


def excused_numbers(absences: Iterable) -> list[int]:
    return [absence.student_number for absence in absences if absence.mark_type.value == "excused"]
