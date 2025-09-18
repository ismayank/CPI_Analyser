import os
import json
import tempfile
import shutil
import subprocess
from flask import Flask, jsonify, request

# Optional: Google GenAI SDK (pip install google-genai)
try:
    from google import genai
    HAS_GENAI = True
except Exception:
    HAS_GENAI = False

app = Flask(__name__)


def safe_clone_and_diff(git_url: str):
    """Clone repo into a temp dir and compute diff between HEAD~1 and HEAD.
    Returns (git_diff_output: str, changed_json_files: list[dict]).
    """
    tmpdir = tempfile.mkdtemp(prefix="repo-")
    repo_path = os.path.join(tmpdir, "repo")
    try:
        # Shallow clone for speed
        subprocess.run(["git", "clone", "--depth", "2", git_url, repo_path], check=True, capture_output=True, text=True)
        # Ensure repo has at least 2 commits
        count_proc = subprocess.run(["git", "-C", repo_path, "rev-list", "--count", "HEAD"], check=True, capture_output=True, text=True)
        commit_count = int(count_proc.stdout.strip() or "0")
        if commit_count < 2:
            return None, None, "Repository must have at least 2 commits"

        # git diff HEAD~1..HEAD
        diff_proc = subprocess.run(["git", "-C", repo_path, "diff", "HEAD~1", "HEAD"], check=True, capture_output=True, text=True)
        git_diff_output = diff_proc.stdout

        # changed file names
        name_only_proc = subprocess.run(["git", "-C", repo_path, "diff", "--name-only", "HEAD~1", "HEAD"], check=True, capture_output=True, text=True)
        changed_files = [p for p in name_only_proc.stdout.strip().split("\n") if p]

        json_files = [p for p in changed_files if p.lower().endswith('.json')]
        json_objects = []
        for rel in json_files:
            abspath = os.path.join(repo_path, rel)
            try:
                with open(abspath, 'r') as f:
                    content = json.load(f)
                json_objects.append({"file_name": rel, "content": content})
            except Exception as e:
                json_objects.append({"file_name": rel, "content": f"Error reading file: {e}"})

        payload = {"git_diff": git_diff_output, "json_files": json_objects}
        return payload, tmpdir, None
    except subprocess.CalledProcessError as e:
        return None, tmpdir, f"Git error: {e.stderr or e.stdout}"
    except Exception as e:
        return None, tmpdir, str(e)


@app.route("/generate", methods=["POST"])
def generate():
    """Generate AI documentation from either a provided 'report' JSON (preferred)
    or by cloning a repo when 'git_url' is provided. Returns JSON with 'result'.
    """
    try:
        data = request.get_json(force=True, silent=False) or {}
        report = data.get("report")
        git_url = data.get("git_url")
        template_text = data.get("template")  # raw template text (JSON or free text)
        output_mode = data.get("output", "files")  # 'files' | 'table' | 'multi_tables' | 'summary'
        changes = data.get("changes")  # flattened changes from backend

        input_payload = None
        tmpdir = None
        if report:
            input_payload = {"report": report}
        elif git_url:
            payload, tmpdir, err = safe_clone_and_diff(git_url)
            if err:
                return jsonify({"error": err}), 400
            input_payload = payload
        elif template_text:
            # If template is JSON, try to parse it; else keep as text
            parsed_template = None
            try:
                parsed_template = json.loads(template_text)
            except Exception:
                parsed_template = None
            input_payload = {"template": parsed_template if parsed_template is not None else template_text}
        elif isinstance(changes, list):
            input_payload = {"changes": changes, "title": data.get("title"), "description": data.get("description")}
        else:
            return jsonify({"error": "Provide either 'report' or 'git_url'"}), 400

        # If no GenAI available, just echo payload keys to prove plumbing
        if not HAS_GENAI:
            return jsonify({
                "result": {
                    "summary": "GenAI SDK not installed. Echoing input keys.",
                    "keys": list(input_payload.keys())
                }
            }), 200

        api_key = os.getenv("GENAI_API_KEY")
        if not api_key:
            return jsonify({"error": "GENAI_API_KEY not configured"}), 500

        client = genai.Client(api_key=api_key)
        if output_mode == "multi_tables":
            # Deterministic multi-table renderer (no LLM formatting needed), when possible
            # Case A: template JSON provided -> produce per-top-level-key tables like P31, P463 ...
            if isinstance(input_payload.get("template"), dict):
                tpl = input_payload["template"]
                tables = []
                for key, arr in tpl.items():
                    if not isinstance(arr, list):
                        continue

                    # First pass: collect language keys present in labels to define stable columns
                    lang_set = set()
                    for entry in arr:
                        mainsnak = (entry or {}).get("mainsnak", {})
                        dv = mainsnak.get("datavalue", {})
                        if isinstance(dv, dict):
                            val = dv.get("value")
                            if isinstance(val, dict):
                                labels = val.get("labels")
                                if isinstance(labels, dict):
                                    for lang in labels.keys():
                                        lang_set.add(str(lang))
                    lang_cols = sorted(list(lang_set))

                    base_cols = ["property", "datatype", "id"]
                    columns = base_cols + lang_cols + ["rank"]
                    rows = []
                    for entry in arr:
                        mainsnak = (entry or {}).get("mainsnak", {})
                        prop = mainsnak.get("property", "")
                        dtype = mainsnak.get("datatype", "")
                        dv = mainsnak.get("datavalue", {})
                        val = dv.get("value") if isinstance(dv, dict) else None
                        ent_id = ""
                        label_map = {}
                        if isinstance(val, dict):
                            ent_id = str(val.get("id", ""))
                            labels = val.get("labels")
                            if isinstance(labels, dict):
                                for lang, txt in labels.items():
                                    label_map[str(lang)] = str(txt)
                        rank = (entry or {}).get("rank", "")

                        row = [str(prop), str(dtype), ent_id]
                        # fill languages in order
                        for lang in lang_cols:
                            row.append(label_map.get(lang, ""))
                        row.append(str(rank))
                        rows.append(row)

                    # Fallback if no languages/id present: show raw datavalue
                    if len(columns) == 4 and columns[-1] == "rank" and not any(r[2] for r in rows):
                        columns = ["property", "datatype", "datavalue", "rank"]
                        rows = []
                        for entry in arr:
                            mainsnak = (entry or {}).get("mainsnak", {})
                            prop = mainsnak.get("property", "")
                            dtype = mainsnak.get("datatype", "")
                            dv = mainsnak.get("datavalue", {})
                            dv_text = json.dumps(dv.get("value"), ensure_ascii=False) if isinstance(dv, dict) else json.dumps(dv, ensure_ascii=False)
                            rank = (entry or {}).get("rank", "")
                            rows.append([str(prop), str(dtype), dv_text if dv_text is not None else "", str(rank)])

                    tables.append({"name": key, "columns": columns, "rows": rows})

                result = {
                    "title": input_payload.get("title") or "Template Tables",
                    "description": input_payload.get("description") or "Structured view of template entries by top-level key.",
                    "tables": tables,
                }
                return jsonify({"result": result}), 200

            # Case B: flattened changes provided -> produce per-file tables
            if isinstance(input_payload.get("changes"), list):
                tables = []
                by_file = {}
                for ch in input_payload["changes"]:
                    file = str(ch.get("file", ""))
                    by_file.setdefault(file, []).append(ch)
                for file, items in by_file.items():
                    columns = ["Path", "New Value"]
                    rows = []
                    for ch in items:
                        rows.append([
                            str(ch.get("path", "")),
                            json.dumps(ch.get("after"), ensure_ascii=False)
                        ])
                    tables.append({"name": file or "Changes", "columns": columns, "rows": rows})
                result = {
                    "title": input_payload.get("title") or "JSON Changes",
                    "description": input_payload.get("description") or "Only the new values after changes.",
                    "tables": tables,
                }
                return jsonify({"result": result}), 200

            # If we cannot deterministically format, fall back to LLM table schema
            output_mode = "table"

        if output_mode == "summary":
            # Ask the model to write a concise business-facing summary only
            prompt = (
                "You are a release documentation assistant. Given a set of JSON changes (only newly added or modified values), "
                "write a concise summary of the impact of these changes for a changelog. Focus on what was added or updated, "
                "and potential user or system impact. Return STRICT JSON only with this schema (no extra keys, no markdown):\n"
                "{\n  \"description\": string\n}\n"
            )
            resp = client.models.generate_content(
                model=os.getenv("GENAI_MODEL", "gemini-2.5-flash"),
                contents=prompt + json.dumps(input_payload)
            )
            text = getattr(resp, "text", None)
            description = ""
            if text:
                try:
                    parsed = json.loads(text)
                    description = parsed.get("description", "") if isinstance(parsed, dict) else str(parsed)
                except Exception:
                    description = text
            else:
                description = str(resp)

            return jsonify({"result": {"description": description}}), 200

        if output_mode == "table":
            prompt = (
                "You are a release documentation assistant. Given either a repo JSON change report, a git diff + changed JSON files payload, "
                "or an industry-change TEMPLATE (JSON or text), produce a STRICT JSON object with the following schema ONLY (no extra keys, no commentary):\n"
                "{\n"
                "  \"title\": string,\n"
                "  \"description\": string,\n"
                "  \"table\": {\n"
                "    \"columns\": [string],\n"
                "    \"rows\": [[string]]\n"
                "  }\n"
                "}\n\n"
                "Rules: Return ONLY valid JSON for the object above. Do NOT wrap in markdown. Choose clear human-readable columns (e.g., File, Change, Details). Rows must be same length as columns. If information is missing, omit the row or write 'N/A'.\n"
            )
        else:
            prompt = (
                "You are a release documentation assistant. Given either a repo JSON change report or a git diff + changed JSON files payload, "
                "or an industry-change TEMPLATE (JSON or text), produce a STRICT JSON object with the following schema ONLY (no extra keys, no commentary):\n"
                "{\n"
                "  \"title\": string,\n"
                "  \"description\": string,\n"
                "  \"files\": [\n"
                "    {\n"
                "      \"file\": string,\n"
                "      \"changeType\": string,  // one of: added|removed|modified|renamed|unknown\n"
                "      \"changes\": [string],  // bullet points describing what changed\n"
                "      \"notes\": string       // optional human-friendly notes\n"
                "    }\n"
                "  ]\n"
                "}\n\n"
                "Rules: Return ONLY valid JSON for the object above. Do NOT wrap in markdown. If content is insufficient, fill with best-effort summaries.\n"
            )
        # Some SDKs want the whole text in one string
        resp = client.models.generate_content(
            model=os.getenv("GENAI_MODEL", "gemini-2.5-flash"),
            contents=prompt + json.dumps(input_payload)
        )

        # Try to parse JSON from the response text
        text = getattr(resp, "text", None)
        result = None
        if text:
            try:
                result = json.loads(text)
            except Exception:
                # fallback: treat as plain description
                if output_mode == "table":
                    result = {
                        "title": "AI Documentation",
                        "description": text,
                        "table": {"columns": ["Text"], "rows": [[text]]}
                    }
                else:
                    result = {
                        "title": "AI Documentation",
                        "description": text,
                        "files": []
                    }
        else:
            # Fallback: return raw response repr as description
            if output_mode == "table":
                result = {
                    "title": "AI Documentation",
                    "description": str(resp),
                    "table": {"columns": ["Text"], "rows": [[str(resp)]]}
                }
            else:
                result = {
                    "title": "AI Documentation",
                    "description": str(resp),
                    "files": []
                }

        # Normalize to strict schema depending on mode
        if not isinstance(result, dict):
            result = {"title": "AI Documentation", "description": str(result)}
        result.setdefault("title", "AI Documentation")
        result.setdefault("description", "")

        if output_mode == "table":
            table = result.get("table")
            if not isinstance(table, dict):
                table = {"columns": ["Text"], "rows": []}
            columns = table.get("columns")
            rows = table.get("rows")
            if not isinstance(columns, list) or not all(isinstance(c, str) for c in columns):
                columns = ["Text"]
            if not isinstance(rows, list) or not all(isinstance(r, list) for r in rows):
                rows = []
            # Ensure each row length matches columns length
            fixed_rows = []
            for r in rows:
                if len(r) < len(columns):
                    r = r + ["" for _ in range(len(columns) - len(r))]
                elif len(r) > len(columns):
                    r = r[:len(columns)]
                fixed_rows.append([str(x) for x in r])
            result["table"] = {"columns": columns, "rows": fixed_rows}
        else:
            files = result.get("files")
            if not isinstance(files, list):
                files = []
            normalized_files = []
            for f in files:
                if not isinstance(f, dict):
                    normalized_files.append({
                        "file": "Unknown",
                        "changeType": "unknown",
                        "changes": [str(f)],
                        "notes": ""
                    })
                    continue
                file_name = f.get("file") or f.get("name") or "Unknown"
                change_type = f.get("changeType") or f.get("change_type") or "unknown"
                changes_list = f.get("changes")
                if not isinstance(changes_list, list):
                    # if a diff string or object was provided, stringify
                    if changes_list is None and "diff" in f:
                        changes_list = [json.dumps(f.get("diff"))]
                    else:
                        changes_list = [str(changes_list)] if changes_list is not None else []
                notes = f.get("notes")
                if not isinstance(notes, str):
                    notes = json.dumps(notes) if notes is not None else ""
                normalized_files.append({
                    "file": file_name,
                    "changeType": change_type,
                    "changes": [str(c) for c in changes_list],
                    "notes": notes
                })
            result["files"] = normalized_files

        return jsonify({"result": result}), 200
    except Exception as e:
        return jsonify({"error": f"Internal error: {e}"}), 500
    finally:
        # Clean any temp dir created in clone mode
        try:
            if 'tmpdir' in locals() and tmpdir and os.path.isdir(tmpdir):
                shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
