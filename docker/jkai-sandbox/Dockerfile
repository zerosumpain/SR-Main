FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    jq \
    vim-tiny \
    build-essential \
    ca-certificates \
    # Playwright browser deps
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    fonts-liberation \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    requests \
    pandas \
    numpy \
    matplotlib \
    beautifulsoup4 \
    httpx \
    pyyaml \
    playwright \
    lxml

RUN playwright install chromium

RUN npm install -g typescript tsx

RUN useradd -m -s /bin/bash jkai
WORKDIR /home/jkai/workspace
RUN chown -R jkai:jkai /home/jkai

USER jkai

CMD ["sleep", "infinity"]
