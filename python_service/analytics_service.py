"""CampusFlow Python analytics service. Run: python3 python_service/analytics_service.py"""
import json, os
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

HOST, PORT = "127.0.0.1", int(os.environ.get("PYTHON_ANALYTICS_PORT", "8000"))
def rows(table):
    url = f"{os.environ['SUPABASE_URL'].rstrip('/')}/rest/v1/{table}?select=*"
    request = Request(url, headers={"apikey": os.environ["SUPABASE_SERVICE_ROLE_KEY"], "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_ROLE_KEY']}"})
    with urlopen(request, timeout=10) as response: return json.loads(response.read().decode())
def summary():
    students, attendance, assessments = rows("students"), rows("attendance_records"), rows("assessments")
    avg = lambda values: round(sum(values)/len(values)) if values else 0
    today = date.today().isoformat()
    today_records = [r for r in attendance if r["attendance_date"] == today]
    courses = {}
    for student in students:
        data = courses.setdefault(student["course"], {"students": 0, "attendance": [], "grades": []})
        data["students"] += 1; data["attendance"].append(student["attendance"]); data["grades"].append(student["grade"])
    return {"generatedAt": today, "totalStudents": len(students), "averageAttendance": avg([s["attendance"] for s in students]), "averageGrade": avg([s["grade"] for s in students]), "assessmentCount": len(assessments), "todayAttendance": {"date": today, "recorded": len(today_records), "present": sum(r["status"] in ("present", "late") for r in today_records)}, "courses": [{"name": name, "students": d["students"], "averageAttendance": avg(d["attendance"]), "averageGrade": avg(d["grades"])} for name, d in sorted(courses.items())]}
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health": return self.reply(200, {"status": "ok", "service": "campusflow-python-analytics"})
        if self.path != "/summary": return self.reply(404, {"error": "Not found"})
        try: return self.reply(200, summary())
        except Exception as error: return self.reply(502, {"error": "Unable to produce analytics report.", "detail": str(error)})
    def reply(self, status, body):
        data = json.dumps(body).encode(); self.send_response(status); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(data)
if __name__ == "__main__":
    print(f"CampusFlow Python analytics: http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
