import os
import json
import shutil
import uuid
import io
from pathlib import Path
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI
from aip import AipSpeech
from docx import Document
from pypdf import PdfReader
from db import get_db_connection

# 1. 配置加载
base_dir = Path(__file__).resolve().parent
env_path = base_dir / '.env'
load_dotenv(dotenv_path=str(env_path))

UPLOAD_DIR = base_dir / "recordings"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/recordings", StaticFiles(directory=str(UPLOAD_DIR)), name="recordings")

client = OpenAI(api_key=os.getenv("DEEPSEEK_API_KEY"), base_url=os.getenv("DEEPSEEK_BASE_URL"))

b_id, b_key, b_secret = os.getenv("BAIDU_APP_ID"), os.getenv("BAIDU_API_KEY"), os.getenv("BAIDU_SECRET_KEY")
baidu_client = AipSpeech(str(b_id), str(b_key), str(b_secret)) if all([b_id, b_key, b_secret]) else None

# --- 辅助函数 ---
def extract_text_from_file(file_content: bytes, filename: str) -> str:
    text = ""
    try:
        if filename.endswith(".docx"):
            doc = Document(io.BytesIO(file_content))
            for para in doc.paragraphs: text += para.text + "\n"
        elif filename.endswith(".pdf"):
            reader = PdfReader(io.BytesIO(file_content))
            for page in reader.pages: text += page.extract_text() + "\n"
        return text.strip()
    except Exception as e:
        print(f"❌ 解析失败: {e}")
        return ""

def call_deepseek_json(system_prompt, user_prompt):
    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            response_format={'type': 'json_object'}, temperature=0.7
        )
        content = response.choices[0].message.content
        if content.startswith("```json"): content = content[7:]
        if content.endswith("```"): content = content[:-3]
        return json.loads(content)
    except Exception as e:
        print(f"DeepSeek Error: {e}")
        return {"error": str(e)}

class JobRequest(BaseModel):
    session_id: str
    job_title: str
    count: int = 3
    existing_questions: List[str] = []
    resume_text: Optional[str] = ""

# ===========================
# 写入接口 (POST)
# ===========================

@app.post("/api/session/create")
async def create_session(id: str = Form(...), title: str = Form(...), resume_text: str = Form("")):
    conn = get_db_connection(); cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO sessions (id, title, resume_text) VALUES (%s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, resume_text = CASE WHEN EXCLUDED.resume_text != '' THEN EXCLUDED.resume_text ELSE sessions.resume_text END;
        """, (id, title, resume_text))
        conn.commit()
        return {"status": "success"}
    finally: cur.close(); conn.close()

# [新增] 手动添加题目入库
@app.post("/api/question/create")
async def create_question(session_id: str = Form(...), text: str = Form(...), type: str = Form(...)):
    q_id = str(uuid.uuid4())
    conn = get_db_connection(); cur = conn.cursor()
    try:
        cur.execute("INSERT INTO questions (id, session_id, text, type) VALUES (%s, %s, %s, %s)", (q_id, session_id, text, type))
        conn.commit()
        return {"status": "success", "id": q_id}
    except Exception as e: return {"status": "error", "msg": str(e)}
    finally: cur.close(); conn.close()

@app.delete("/api/question/delete")
async def delete_question(question_id: str):
    conn = get_db_connection(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM questions WHERE id = %s", (question_id,))
        conn.commit()
        return {"status": "success"}
    finally: cur.close(); conn.close()

@app.post("/api/parse_resume")
async def parse_resume(file: UploadFile = File(...)):
    content = await file.read()
    text = extract_text_from_file(content, file.filename)
    if not text: raise HTTPException(status_code=400, detail="解析失败")
    return {"text": text}

@app.post("/api/generate")
async def generate(req: JobRequest):
    print(f"🔄 生成题目 | 岗位: {req.job_title}")
    resume_part = f"\n【简历摘要】:\n{req.resume_text[:2000]}" if req.resume_text else ""
    system_prompt = f"""
    资深面试官。根据岗位{resume_part}生成 {req.count} 个面试题。
    要求：涵盖硬技能、软技能、行业洞察。避免重复：{json.dumps(req.existing_questions, ensure_ascii=False)}
    JSON格式：{{ "questions": [ {{ "text": "...", "type": "硬技能" }} ] }}
    """
    result = call_deepseek_json(system_prompt, f"岗位：{req.job_title}")
    questions_to_return = []
    if "questions" in result:
        conn = get_db_connection(); cur = conn.cursor()
        for q in result["questions"]:
            q_id = str(uuid.uuid4())
            questions_to_return.append({"id": q_id, "text": q["text"], "type": q.get("type", "通用")})
            cur.execute("INSERT INTO questions (id, session_id, text, type) VALUES (%s, %s, %s, %s)", (q_id, req.session_id, q["text"], q.get("type", "通用")))
        conn.commit(); cur.close(); conn.close()
    return {"questions": questions_to_return}

@app.post("/api/analyze")
async def analyze(
    file: UploadFile = File(...), question_text: str = Form(...), job_title: str = Form(...),
    resume_text: str = Form(""), question_id: str = Form(...), attempt_id: str = Form(...)
):
    print(f"🎤 分析录音 | 题目: {question_text[:10]}...")
    file_ext = Path(file.filename).suffix or ".wav"
    filename = f"{attempt_id}{file_ext}"
    file_path = UPLOAD_DIR / filename
    with open(file_path, "wb") as buffer: shutil.copyfileobj(file.file, buffer)
    audio_url = f"http://localhost:8000/recordings/{filename}" # 需根据实际部署修改host

    try:
        user_spoken_text = ""
        if baidu_client:
            with open(file_path, 'rb') as fp: audio_data = fp.read()
            res = baidu_client.asr(audio_data, 'wav', 16000, {'dev_pid': 1537})
            user_spoken_text = res['result'][0] if res.get('err_no') == 0 else f"(识别失败: {res.get('err_msg')})"
        else: user_spoken_text = "(语音服务未配置)"

        system_prompt = f"""
        严厉面试官。打分(0-100)和点评。
        {f"【简历核对】：{resume_text[:1500]}" if resume_text else ""}
        JSON格式：{{ "score": 0, "feedback": "", "pros": [], "cons": [], "betterAnswer": "" }}
        """
        analysis = call_deepseek_json(system_prompt, f"岗位:{job_title}\n问题:{question_text}\n回答:{user_spoken_text}")
        
        conn = get_db_connection(); cur = conn.cursor()
        cur.execute("""
            INSERT INTO attempts (id, question_id, transcription, audio_url, score, feedback, pros, cons, better_answer) 
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (attempt_id, question_id, user_spoken_text, audio_url, analysis.get('score',0), analysis.get('feedback',''), json.dumps(analysis.get('pros',[])), json.dumps(analysis.get('cons',[])), analysis.get('betterAnswer','')))
        conn.commit(); cur.close(); conn.close()
        
        return {"transcription": user_spoken_text, "analysis": analysis, "audio_url": audio_url}
    except Exception as e:
        print(f"❌ Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ===========================
# 读取接口 (GET) - 让前端能读到历史
# ===========================

@app.get("/api/sessions")
async def get_sessions():
    conn = get_db_connection(); cur = conn.cursor()
    try:
        cur.execute("SELECT id, title, resume_text, created_at FROM sessions ORDER BY created_at DESC")
        rows = cur.fetchall()
        return {"sessions": [{"id": r["id"], "title": r["title"], "resumeText": r["resume_text"], "createdAt": int(r["created_at"].timestamp() * 1000)} for r in rows]}
    finally: cur.close(); conn.close()

@app.get("/api/questions")
async def get_questions(session_id: str):
    conn = get_db_connection(); cur = conn.cursor()
    try:
        cur.execute("SELECT id, text, type FROM questions WHERE session_id = %s ORDER BY created_at ASC", (session_id,))
        return {"questions": cur.fetchall()}
    finally: cur.close(); conn.close()

@app.get("/api/attempts")
async def get_attempts(question_id: str):
    conn = get_db_connection(); cur = conn.cursor()
    try:
        cur.execute("SELECT id, transcription, audio_url, score, feedback, pros, cons, better_answer, created_at FROM attempts WHERE question_id = %s ORDER BY created_at ASC", (question_id,))
        rows = cur.fetchall()
        attempts = []
        for r in rows:
            analysis = None
            if r["score"] is not None:
                analysis = {"score": r["score"], "feedback": r["feedback"], "pros": r["pros"] if r["pros"] else [], "cons": r["cons"] if r["cons"] else [], "betterAnswer": r["better_answer"]}
            attempts.append({"id": r["id"], "url": r["audio_url"] or "", "timestamp": int(r["created_at"].timestamp() * 1000), "durationString": "录音", "transcription": r["transcription"], "analysis": analysis})
        return {"attempts": attempts}
    finally: cur.close(); conn.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)