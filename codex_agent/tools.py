import subprocess
import tempfile
import os
import sys
import ast
import re

def execute_python(code: str) -> dict:
    """Executes a Python code snippet and returns stdout/stderr."""
    blocked = ["os.system", "shutil.rmtree", "__import__('os').remove"]
    for b in blocked:
        if b in code:
            return {"status": "error", "output": "", "error": f"Blocked: '{b}'."}
    try:
        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
            f.write(code)
            tmp = f.name
        result = subprocess.run([sys.executable, tmp], capture_output=True, text=True, timeout=15)
        os.unlink(tmp)
        return {
            "status": "success" if result.returncode == 0 else "error",
            "output": result.stdout.strip(),
            "error": result.stderr.strip(),
        }
    except subprocess.TimeoutExpired:
        return {"status": "error", "output": "", "error": "Timed out after 15s."}
    except Exception as e:
        return {"status": "error", "output": "", "error": str(e)}

def analyze_code(code: str, language: str = "python") -> dict:
    """Analyzes code for syntax errors, style issues, and suggestions."""
    issues, suggestions = [], []
    if language.lower() == "python":
        try:
            ast.parse(code)
        except SyntaxError as e:
            issues.append(f"Syntax error at line {e.lineno}: {e.msg}")
        for i, line in enumerate(code.split("\n"), 1):
            if len(line) > 120:
                issues.append(f"Line {i} exceeds 120 chars.")
            if line.endswith(" ") or line.endswith("\t"):
                issues.append(f"Line {i} has trailing whitespace.")
        if "print(" in code and "logging" not in code:
            suggestions.append("Use logging instead of print() in production.")
        if "except:" in code and "except Exception" not in code:
            suggestions.append("Avoid bare except.")
    elif language.lower() in ["javascript", "typescript", "js", "ts"]:
        if "var " in code:
            suggestions.append("Prefer const/let over var.")
        if "==" in code and "===" not in code:
            suggestions.append("Use === for strict equality.")
        if "console.log" in code:
            suggestions.append("Remove console.log() before production.")
    return {
        "status": "success",
        "language": language,
        "summary": "No issues." if not issues else f"{len(issues)} issue(s) found.",
        "issues": issues,
        "suggestions": suggestions,
    }

def explain_code(code: str) -> dict:
    """Detects language and extracts structure for explanation."""
    lang = "unknown"
    if re.search(r"def |import |from .+ import|class .+:", code):
        lang = "Python"
    elif re.search(r"fun |val |var |data class|object |companion object", code):
        lang = "Kotlin"
    elif re.search(r"function |const |let |var |=>|require\(", code):
        lang = "JavaScript/TypeScript"
    elif re.search(r"#include|int main|std::", code):
        lang = "C/C++"
    elif re.search(r"public class|System\.out\.println|import java", code):
        lang = "Java"
    elif re.search(r"<html|<div|<body|<!DOCTYPE", code, re.IGNORECASE):
        lang = "HTML"
    elif re.search(r"SELECT|INSERT|UPDATE|DELETE|CREATE TABLE", code, re.IGNORECASE):
        lang = "SQL"
    elif re.search(r"^#!|echo |chmod |grep |awk |sed ", code, re.MULTILINE):
        lang = "Bash/Shell"
    return {
        "status": "success",
        "detected_language": lang,
        "line_count": len(code.strip().split("\n")),
        "functions_found": re.findall(r"def (\w+)\(", code),
        "classes_found": re.findall(r"class (\w+)", code),
        "code_snippet": code[:500] + ("..." if len(code) > 500 else ""),
    }

def generate_tests(function_code: str, test_framework: str = "pytest") -> dict:
    """Generates unit test boilerplate for a Python function."""
    match = re.search(r"def (\w+)\((.*?)\)", function_code)
    if not match:
        return {"status": "error", "test_code": "", "error": "No function found."}
    func_name = match.group(1)
    args = [
        a.strip().split(":")[0].split("=")[0].strip()
        for a in match.group(2).split(",")
        if a.strip() and a.strip() != "self"
    ]
    placeholder = ", ".join(["None"] * len(args))
    if test_framework == "pytest":
        test_code = (
            f"import pytest\n\n{function_code}\n\n"
            f"class Test{func_name.capitalize()}:\n"
            f"    def test_{func_name}_basic(self):\n"
            f"        result = {func_name}({placeholder})\n"
            f"        assert result is not None\n\n"
            f"    def test_{func_name}_edge_case(self):\n"
            f"        pass\n"
        )
    else:
        test_code = (
            f"import unittest\n\n{function_code}\n\n"
            f"class Test{func_name.capitalize()}(unittest.TestCase):\n"
            f"    def test_{func_name}_basic(self):\n"
            f"        result = {func_name}({placeholder})\n"
            f"        self.assertIsNotNone(result)\n\n"
            f"if __name__ == '__main__':\n    unittest.main()\n"
        )
    return {"status": "success", "framework": test_framework, "function_name": func_name, "test_code": test_code}

def format_code(code: str, language: str = "python") -> dict:
    """Formats Python code with basic PEP8 conventions."""
    if language.lower() != "python":
        return {"status": "info", "formatted_code": code, "message": f"Auto-formatting not supported for {language}."}
    formatted = "\n".join(line.rstrip() for line in code.split("\n")).rstrip("\n") + "\n"
    return {"status": "success", "language": language, "formatted_code": formatted}

def security_scan(code: str, language: str = "python") -> dict:
    """Scans code for common security vulnerabilities."""
    findings = []
    patterns = [
        (r"eval\s*\(", "critical", "eval() executes arbitrary code."),
        (r"exec\s*\(", "critical", "exec() executes arbitrary code."),
        (r"pickle\.loads?\s*\(", "high", "pickle can execute code on deserialization."),
        (r"os\.system\s*\(", "high", "os.system() is vulnerable to injection."),
        (r"shell=True", "high", "shell=True enables shell injection."),
        (r"password\s*=\s*['\"][^'\"]+['\"]", "high", "Hardcoded password detected."),
        (r"secret\s*=\s*['\"][^'\"]+['\"]", "high", "Hardcoded secret detected."),
        (r"api_key\s*=\s*['\"][^'\"]+['\"]", "high", "Hardcoded API key detected."),
        (r"SELECT.+FROM.+\+", "high", "Possible SQL injection via string concat."),
        (r"innerHTML\s*=", "medium", "innerHTML can cause XSS."),
        (r"md5\s*\(", "medium", "MD5 is broken - use SHA-256 or bcrypt."),
        (r"sha1\s*\(", "medium", "SHA-1 is deprecated."),
        (r"random\.\w+\s*\(", "low", "random is not cryptographically secure."),
        (r"http://", "low", "Plain HTTP - use HTTPS."),
        (r"debug\s*=\s*True", "medium", "Debug mode enabled - disable for production."),
        (r"verify\s*=\s*False", "medium", "SSL verification disabled."),
    ]
    for pattern, severity, message in patterns:
        if re.search(pattern, code, re.IGNORECASE):
            findings.append({"severity": severity, "message": message})
    if not findings:
        return {"status": "success", "severity": "none", "findings": [], "summary": "No security issues detected."}
    levels = ["low", "medium", "high", "critical"]
    highest = max((f["severity"] for f in findings), key=lambda s: levels.index(s) if s in levels else 0)
    return {"status": "success", "severity": highest, "findings": findings, "summary": f"{len(findings)} issue(s) found. Highest: {highest.upper()}"}

CODEX_AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
SUB_AGENTS_DIR = os.path.join(CODEX_AGENT_DIR, "sub_agents")

def load_prompt(filename: str, fallback: str = "") -> str:
    """Reads a prompt from the new modular locations (searching recursively), with a fallback."""
    # Search in codex_agent/ and all subdirectories
    for root, dirs, files in os.walk(CODEX_AGENT_DIR):
        if filename in files:
            path = os.path.join(root, filename)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return f.read().strip()
            except Exception as e:
                print(f"Warning: Error reading prompt at {path}: {e}")
            
    return fallback
