import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

def get_db_connection():
    """获取数据库连接"""
    conn = psycopg2.connect(
        os.getenv("DATABASE_URL"),
        cursor_factory=RealDictCursor # 让查询结果以字典形式返回，方便转JSON
    )
    return conn

def init_db():
    """初始化数据库表结构 (运行一次即可)"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    # 1. 创建 Sessions 表 (存放岗位 + 简历)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            resume_text TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    # 2. 创建 Questions 表 (存放题目)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS questions (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            text TEXT NOT NULL,
            type TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    # 3. 创建 Attempts 表 (存放回答 + AI分析)
    # 使用 JSONB 存储数组类型的 pros/cons，方便且性能好
    cur.execute("""
        CREATE TABLE IF NOT EXISTS attempts (
            id TEXT PRIMARY KEY,
            question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
            audio_url TEXT,
            duration_string TEXT,
            transcription TEXT,
            score INTEGER,
            feedback TEXT,
            pros JSONB, 
            cons JSONB,
            better_answer TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    conn.commit()
    cur.close()
    conn.close()
    print("✅ 数据库表结构初始化完成！")
    
# 如果直接运行此文件，则执行初始化
if __name__ == "__main__":
    init_db()