import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
MODEL_FAST = os.getenv("MODEL_FAST", "anthropic/claude-haiku-5.5")
MODEL_SMART = os.getenv("MODEL_SMART", "anthropic/claude-sonnet-5.5")
SPEND_CAP_USD = float(os.getenv("SPEND_CAP_USD", "18"))

QDRANT_URL = os.getenv("QDRANT_URL", "")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")
QDRANT_PATH = os.getenv("QDRANT_PATH", str(BASE_DIR / ".qdrant"))

DATABASE_URL = os.getenv("DATABASE_URL") or f"sqlite:///{BASE_DIR / 'stacksmith.db'}"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-secret-change-me")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
APP_URL = os.getenv("APP_URL", "http://localhost:3000")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

# Live-run limits (replays of sample businesses are free and unlimited)
LIVE_RUNS_PER_USER_PER_DAY = int(os.getenv("LIVE_RUNS_PER_USER_PER_DAY", "5"))
LIVE_RUNS_PER_IP_PER_DAY_DEMO = int(os.getenv("LIVE_RUNS_PER_IP_PER_DAY_DEMO", "2"))

DATA_DIR = BASE_DIR / "data"
DEMO_RUNS_DIR = DATA_DIR / "demo_runs"
