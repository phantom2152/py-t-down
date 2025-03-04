FROM python:3.10.15-slim

WORKDIR /src/app


COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd -u 10001 -m appuser && chown -R 10001:10001 /src/app
USER 10001

EXPOSE 5000

CMD ["gunicorn", "--worker-class", "eventlet", "-w", "1", "--bind", "0.0.0.0:5000", "app:app"]