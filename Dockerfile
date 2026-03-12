# Use the official Python 3.11 slim image for a smaller footprint
FROM python:3.11-slim

# Set the working directory inside the container
WORKDIR /app

# Ensure standard output isn't buffered (helps with Cloud Run logging)
ENV PYTHONUNBUFFERED=1

# Install system dependencies required for some python packages like psycopg2
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy the requirements file and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the core backend code
COPY backend/ backend/

# Expose port 8000 for Cloud Run
EXPOSE 8000

# Start the FastAPI application directly using uvicorn
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
