"""Public UW snapshot importer. Requires lxml and pdfplumber; no credentials.
Run from repository: python server/uw_ingest.py [--offline]
Unknown layouts stop import; PDF text is evidence, not an automatic dish match.
"""
import argparse
import hashlib
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo
from lxml import html
import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src/data/uw"
RAW = DATA / "sources"
BASE = "https://hfs.washington.edu"
VENUES = {"local-point": "Local Point", "center-table": "Center Table", "husky-den": "Husky Den Food Court"}

def clean(value):
    return " ".join(value.split())

def fetch(url, offline=False):
    if urlparse(url).hostname != "hfs.washington.edu" or urlparse(url).scheme != "https":
        raise ValueError("Only public official UW HFS URLs are supported")
    key = hashlib.sha256(url.encode()).hexdigest()[:16]
    dest = RAW / (key + (".pdf" if urlparse(url).path.endswith(".pdf") else ".html"))
    if not offline:
        # No redirects, cookies, authentication, or access-control bypass.
        value = subprocess.check_output(["curl", "--fail", "--silent", "--show-error", "--max-time", "45", url])
        if not value: raise ValueError("Empty public source")
        dest.write_bytes(value)
    meta = dest.with_suffix(dest.suffix + ".meta.json")
    if not offline:
        meta.write_text(json.dumps({"checkedAt": datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat()}))
    checked_at = json.loads(meta.read_text())["checkedAt"]
    value = dest.read_bytes()
    return value, {"checkedAt": checked_at, "sourceUrl": url, "file": str(dest.relative_to(DATA)), "responseSha256": hashlib.sha256(value).hexdigest()}

def run(offline=False, ocr=False):
    RAW.mkdir(parents=True, exist_ok=True)
    checked = datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat()
    sources, pages, venues, menus = [], [], [], []
    data, evidence = fetch(BASE + "/nutrition/", offline)
    sources.append(evidence)
    tree = html.fromstring(data)
    for venue_id, name in VENUES.items():
        groups = tree.xpath("//li[ul][text()[contains(., $name)]]", name=name)
        if len(groups) != 1: raise ValueError("Nutrition location grouping changed: " + name)
        for link in groups[0].xpath("./ul/li/a"):
            station = clean(link.text_content())
            url = urljoin(BASE, link.get("href"))
            body, evidence = fetch(url, offline)
            sources.append(evidence)
            table = html.fromstring(body).xpath('//table[@id="nutrition-table"]')
            if not table:
                pages.append({**evidence, "checkedAt": evidence["checkedAt"], "venueId": venue_id, "location": name, "station": station, "headers": [], "rows": [], "status": "table_not_published"})
                continue
            if len(table) != 1: raise ValueError("Ambiguous nutrition table: " + url)
            headers = [clean(x.text_content()) for x in table[0].xpath("./thead/tr[last()]/*")]
            required = ["Item name", "Vegan / Vegetarian", "Suggested Serving", "Calories", "Sat. Fat", "Total Carbs", "Sodium"]
            if headers[:7] != required or len(set(headers)) != len(headers): raise ValueError("Changed headers")
            rows = [[clean(x.text_content()) for x in row.xpath("./th|./td")] for row in table[0].xpath("./tbody/tr")]
            if any(len(row) != len(headers) for row in rows): raise ValueError("Misaligned nutrition table")
            pages.append({**evidence, "checkedAt": evidence["checkedAt"], "venueId": venue_id, "location": name, "station": station, "headers": headers, "rows": rows})
        url = BASE + "/eat/locations-and-hours/" + venue_id + "/"
        body, evidence = fetch(url, offline)
        sources.append(evidence)
        page = html.fromstring(body)
        main = page.xpath('//main')[0]
        # Preserve special hours and every operating-hours line; reviewed schedules are hash-bound separately.
        for element in main.xpath('.//script|.//style'):
            element.drop_tree()
        text = clean(main.text_content())
        hours_text = text[text.index("Operating hours:"):text.index("Menus and Nutrition:")]
        hours_text = clean(hours_text.replace("Open now", "").replace("Closed now", ""))
        venues.append({"hoursText": hours_text, "hoursSha256": hashlib.sha256(hours_text.encode()).hexdigest(), **evidence, "checkedAt": evidence["checkedAt"], "id": venue_id, "name": name, "rawText": clean(main.text_content()), "mapLinks": main.xpath('.//a[contains(@href,"google.com")]/@href')})
        for link in main.xpath('.//a[contains(@href,".pdf")]'):
            pdfurl = urljoin(BASE, link.get("href"))
            content, pdfsource = fetch(pdfurl, offline)
            if not content.startswith(b"%PDF"): raise ValueError("Not a PDF")
            sources.append(pdfsource)
            ocr_file = DATA / (pdfsource["file"] + ".ocr.json")
            if ocr:
                subprocess.run(["swift", "-module-cache-path", "/private/tmp/whatscooking.ai-swift-modules", str(ROOT / "server/uw_ocr.swift"), str(DATA / pdfsource["file"]), str(ocr_file)], check=True)
            with pdfplumber.open(DATA / pdfsource["file"]) as pdf:
                texts = [p.extract_text(layout=True) or "" for p in pdf.pages]
                words = [p.extract_words() for p in pdf.pages]
            textfile = pdfsource["file"] + ".txt"
            (DATA / textfile).write_text("\n\f\n".join(texts))
            menus.append({**pdfsource, "checkedAt": evidence["checkedAt"], "venueId": venue_id, "discoveredFrom": url, "linkLabel": clean(link.text_content()), "pageCount": len(texts), "textFile": textfile, "pages": texts, "words": words, "ocrFile": str(ocr_file.relative_to(DATA)) if ocr_file.exists() else None, "extractionStatus": "requires_review"})
    for path in ("/eat/husky-deals/", "/eat/nutrition/"):
        body, evidence = fetch(BASE + path, offline)
        sources.append(evidence)
        evidence["rawText"] = clean(html.fromstring(body).xpath('//main')[0].text_content())
    result = {"schemaVersion": 1, "checkedAt": max(source["checkedAt"] for source in sources), "sources": sources, "pages": pages, "venues": venues, "menus": menus}
    (DATA / "snapshot.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"nutritionRows": sum(len(p["rows"]) for p in pages), "stations": len(pages), "weeklyPdfs": len(menus), "venues": len(venues)}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--ocr", action="store_true", help="Use local Apple Vision for image-based dish text; still requires review")
    args = parser.parse_args()
    run(args.offline, args.ocr)
