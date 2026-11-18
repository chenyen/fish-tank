FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Asia/Shanghai \
    DB_PATH=/data/tank.db

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./

VOLUME ["/data"]
EXPOSE 8848

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8848", "--workers", "1"]
