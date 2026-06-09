from bs4 import BeautifulSoup
import re

CORRECT = 5
WRONG = -1
UNATTEMPTED = 0

SESSIONS = [
    {
        "answer_key": "22a.html",
        "response_sheet": "22q.html",
        "label": "Session 1"
    },
    {
        "answer_key": "23a.html",
        "response_sheet": "23q.html",
        "label": "Session 2"
    },
    {
        "answer_key": "31a.html",
        "response_sheet": "31q.html",
        "label": "Session 3"
    }
]

def clean_subject_name(raw):
    cleaned = re.sub(r'^\d+\s*[-–]\s*', '', raw).strip()
    cleaned = re.sub(r'\s*\(Domain\)\s*$', '', cleaned, flags=re.IGNORECASE).strip()
    return cleaned

def parse_answer_key(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    answer_key = {}
    subject_spans = soup.find_all("span", id=re.compile(r"lblsubject$"))
    qno_spans = soup.find_all("span", id=re.compile(r"lbl_QuestionNo$"))
    ranswer_spans = soup.find_all("span", id=re.compile(r"lbl_RAnswer$"))

    for subj_span, qno_span, ranswer_span in zip(subject_spans, qno_spans, ranswer_spans):
        subject_raw = subj_span.get_text(strip=True)
        question_id = qno_span.get_text(strip=True)
        correct_option_id = ranswer_span.get_text(strip=True)
        subject = clean_subject_name(subject_raw)
        if subject and question_id:
            answer_key[question_id] = {
                "subject": subject,
                "correct_option_id": correct_option_id,
            }

    return answer_key

def parse_response_sheet(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    responses = {}
    question_panels = soup.find_all("div", class_="question-pnl")

    for panel in question_panels:
        menu_tbl = panel.find("table", class_="menu-tbl")
        if not menu_tbl:
            continue

        q_num_td = panel.find("td", class_="bold", attrs={"valign": "top", "align": "center"})
        q_number = q_num_td.get_text(strip=True) if q_num_td else ""

        rows = menu_tbl.find_all("tr")
        data = {}
        for row in rows:
            tds = row.find_all("td")
            if len(tds) == 2:
                key = tds[0].get_text(strip=True).rstrip(":").strip()
                val = tds[1].get_text(strip=True)
                data[key] = val

        question_id = data.get("Question ID", "")
        status = data.get("Status", "")
        chosen_option_num = data.get("Chosen Option", "").strip()

        option_ids = {}
        for i in range(1, 5):
            opt_key = f"Option {i} ID"
            if opt_key in data:
                option_ids[i] = data[opt_key]

        chosen_option_id = None
        if chosen_option_num and chosen_option_num.isdigit():
            num = int(chosen_option_num)
            chosen_option_id = option_ids.get(num)

        if question_id:
            responses[question_id] = {
                "status": status,
                "chosen_option_num": chosen_option_num,
                "chosen_option_id": chosen_option_id,
                "option_ids": option_ids,
                "q_number": q_number,
            }

    return responses

def calculate_scores(answer_key, responses, all_results):
    for question_id, ans_data in answer_key.items():
        subject = ans_data["subject"]
        correct_option_id = ans_data["correct_option_id"]

        if question_id not in responses:
            continue

        resp = responses[question_id]
        status = resp["status"]
        chosen_option_id = resp["chosen_option_id"]
        chosen_option_num = resp["chosen_option_num"]

        not_attempted = (
            status in ("Not Answered", "Not Visited", "") or
            not chosen_option_num or
            chosen_option_id is None or
            not chosen_option_num.isdigit()
        )

        if not_attempted:
            points = UNATTEMPTED
            result_label = "NOT ATTEMPTED"
        elif chosen_option_id == correct_option_id:
            points = CORRECT
            result_label = "CORRECT ✓"
        else:
            points = WRONG
            result_label = "WRONG ✗"

        if subject not in all_results:
            all_results[subject] = {"score": 0, "questions": []}

        all_results[subject]["score"] += points
        all_results[subject]["questions"].append({
            "question_id": question_id,
            "q_number": resp.get("q_number", ""),
            "chosen_option_id": chosen_option_id,
            "chosen_option_num": chosen_option_num,
            "correct_option_id": correct_option_id,
            "result": result_label,
            "points": points,
            "status": status,
        })

def print_subject_block(subject, data, colors):
    RESET, BOLD, GREEN, RED, YELLOW, MAGENTA, DIM = (
        colors["RESET"], colors["BOLD"], colors["GREEN"],
        colors["RED"], colors["YELLOW"], colors["MAGENTA"], colors["DIM"]
    )

    score = data["score"]
    questions = data["questions"]

    correct = sum(1 for q in questions if q["result"].startswith("CORRECT"))
    wrong = sum(1 for q in questions if q["result"].startswith("WRONG"))
    unattempted = sum(1 for q in questions if q["result"] == "NOT ATTEMPTED")

    print(f"{BOLD}{MAGENTA}{'─'*80}{RESET}")
    print(f"{BOLD}{MAGENTA}  {subject.upper()}{RESET}")
    print(f"{BOLD}{MAGENTA}{'─'*80}{RESET}")
    print(f"  {BOLD}Questions Matched : {len(questions)}{RESET}")
    print(f"  {GREEN}Correct : {correct}{RESET}  |  {RED}Wrong : {wrong}{RESET}  |  {YELLOW}Not Attempted : {unattempted}{RESET}")
    print(f"  {BOLD}Score : {GREEN if score >= 0 else RED}{score}{RESET}\n")

    questions_sorted = sorted(
        questions,
        key=lambda q: int(q["q_number"].replace("Q.", "")) if q["q_number"].replace("Q.", "").isdigit() else 9999
    )

    print(f"  {'Q.No':<6} {'Your Opt ID':<16} {'Correct Opt ID':<16} {'Result':<20} {'Pts':>4}")
    print(f"  {DIM}{'─'*66}{RESET}")

    for q in questions_sorted:
        res = q["result"]
        color = GREEN if res.startswith("CORRECT") else RED if res.startswith("WRONG") else YELLOW
        chosen_display = q["chosen_option_id"] if q["chosen_option_id"] else "—"
        label = q["q_number"] if q["q_number"] else q["question_id"]
        print(
            f"  {label:<6} "
            f"{chosen_display:<16} "
            f"{q['correct_option_id']:<16} "
            f"{color}{res:<20}{RESET} "
            f"{color}{q['points']:>4}{RESET}"
        )
    print()

def fuzzy_match(subject_name, keywords):
    s = subject_name.lower()
    return any(kw in s for kw in keywords)

def print_results(all_results):
    colors = {
        "RESET":   "\033[0m",
        "GREEN":   "\033[92m",
        "RED":     "\033[91m",
        "YELLOW":  "\033[93m",
        "CYAN":    "\033[96m",
        "BOLD":    "\033[1m",
        "MAGENTA": "\033[95m",
        "DIM":     "\033[2m",
        "BLUE":    "\033[94m",
    }
    RESET, BOLD, GREEN, RED, CYAN, BLUE = (
        colors["RESET"], colors["BOLD"], colors["GREEN"],
        colors["RED"], colors["CYAN"], colors["BLUE"]
    )

    print(f"\n{BOLD}{CYAN}{'='*80}{RESET}")
    print(f"{BOLD}{CYAN}{'CUET UG 2026 — SCORE REPORT':^80}{RESET}")
    print(f"{BOLD}{CYAN}{'='*80}{RESET}\n")

    for subject, data in all_results.items():
        if data["questions"]:
            print_subject_block(subject, data, colors)

    subject_scores = [(s, all_results[s]["score"]) for s in all_results if all_results[s]["questions"]]
    subject_scores_sorted = sorted(subject_scores, key=lambda x: x[1], reverse=True)

    all_total = sum(s for _, s in subject_scores)
    max_per_subject = 250
    all_max = len(subject_scores) * max_per_subject

    n = len(subject_scores)
    best_n = n - 1 if n > 1 else n
    best_subjects = subject_scores_sorted[:best_n]
    best_total = sum(s for _, s in best_subjects)
    best_max = best_n * max_per_subject
    dropped_subjects = subject_scores_sorted[best_n:]

    math_gat_eng_subjects = [
        (name, score) for name, score in subject_scores
        if fuzzy_match(name, ["math", "aptitude", "gat", "general aptitude"]) or
           fuzzy_match(name, ["english", "language"])
    ]
    mge_total = sum(s for _, s in math_gat_eng_subjects)
    mge_max = len(math_gat_eng_subjects) * max_per_subject

    print(f"{BOLD}{CYAN}{'='*80}{RESET}")
    print(f"{BOLD}{CYAN}  SCORE SUMMARY{RESET}")
    print(f"{BOLD}{CYAN}{'='*80}{RESET}\n")

    print(f"  {BOLD}Individual Scores:{RESET}")
    for name, score in subject_scores:
        color = GREEN if score >= 0 else RED
        print(f"    {name:<40} : {color}{score:>5}{RESET}  / {max_per_subject}")
    print()

    print(f"  {BOLD}{BLUE}① BEST OF {best_n}  (out of {best_max}){RESET}")
    for name, score in best_subjects:
        color = GREEN if score >= 0 else RED
        print(f"     ✔ {name:<38} : {color}{score}{RESET}")
    for name, score in dropped_subjects:
        print(f"     ✘ Dropped: {name} ({score})")
    print(f"     {BOLD}Total : {GREEN if best_total >= 0 else RED}{best_total} / {best_max}{RESET}\n")

    print(f"  {BOLD}{BLUE}② ALL {n} SUBJECTS  (out of {all_max}){RESET}")
    print(f"     {BOLD}Total : {GREEN if all_total >= 0 else RED}{all_total} / {all_max}{RESET}\n")

    if math_gat_eng_subjects:
        print(f"  {BOLD}{BLUE}③ MATHS + GAT + ENGLISH  (out of {mge_max}){RESET}")
        for name, score in math_gat_eng_subjects:
            color = GREEN if score >= 0 else RED
            print(f"     {name:<40} : {color}{score}{RESET}")
        print(f"     {BOLD}Total : {GREEN if mge_total >= 0 else RED}{mge_total} / {mge_max}{RESET}\n")

    print(f"{BOLD}{CYAN}{'='*80}{RESET}\n")

def main():
    all_results = {}

    for session in SESSIONS:
        print(f"Parsing {session['label']} answer key  ({session['answer_key']})...")
        answer_key = parse_answer_key(session["answer_key"])

        subject_counts = {}
        for v in answer_key.values():
            s = v["subject"]
            subject_counts[s] = subject_counts.get(s, 0) + 1
        print(f"  Found {len(answer_key)} questions")
        for s, c in subject_counts.items():
            print(f"    {s}: {c}")

        print(f"Parsing {session['label']} response sheet ({session['response_sheet']})...")
        responses = parse_response_sheet(session["response_sheet"])
        print(f"  Found {len(responses)} responses\n")

        calculate_scores(answer_key, responses, all_results)

    print_results(all_results)

if __name__ == "__main__":
    main()
