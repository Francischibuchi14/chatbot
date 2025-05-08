from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os
from dotenv import load_dotenv
import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

# Configuration
API_PROVIDER = os.getenv("API_PROVIDER", "openai").lower()
API_TIMEOUT = int(os.getenv("API_TIMEOUT", 30))

# Set up logging
log_handler = RotatingFileHandler('app.log', maxBytes=100000, backupCount=3)
log_handler.setFormatter(logging.Formatter(
    '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
))
app.logger.addHandler(log_handler)
app.logger.setLevel(logging.INFO)

def get_openai_response(message):
    """Handle OpenAI API requests"""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OpenAI API key not configured")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    data = {
        "model": os.getenv("OPENAI_MODEL", "gpt-3.5-turbo"),
        "messages": [{"role": "user", "content": message}],
        "temperature": 0.7
    }

    try:
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=data,
            timeout=API_TIMEOUT
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]
    except Exception as e:
        raise Exception(f"OpenAI API error: {str(e)}")

def get_anthropic_response(message):
    """Handle Anthropic Claude API requests"""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("Anthropic API key not configured")

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
    }

    data = {
        "model": os.getenv("ANTHROPIC_MODEL", "claude-3-haiku-20240307"),
        "max_tokens": 1000,
        "messages": [{"role": "user", "content": message}]
    }

    try:
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers=headers,
            json=data,
            timeout=API_TIMEOUT
        )
        response.raise_for_status()
        return response.json()["content"][0]["text"]
    except Exception as e:
        raise Exception(f"Anthropic API error: {str(e)}")

def get_openrouter_response(message):
    """Handle OpenRouter API requests"""
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("OpenRouter API key not configured")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": os.getenv("APP_URL", "http://localhost:5000"),
        "X-Title": os.getenv("APP_NAME", "AI Chatbot"),
        "Content-Type": "application/json"
    }

    data = {
        "model": os.getenv("OPENROUTER_MODEL", "openai/gpt-3.5-turbo"),
        "messages": [{"role": "user", "content": message}]
    }

    try:
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=data,
            timeout=API_TIMEOUT
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]
    except Exception as e:
        raise Exception(f"OpenRouter API error: {str(e)}")

# Provider dispatcher
PROVIDER_DISPATCHER = {
    "openai": get_openai_response,
    "anthropic": get_anthropic_response,
    "openrouter": get_openrouter_response
}

@app.route('/api/chat', methods=['POST'])
def chat():
    """Main chat endpoint"""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    try:
        data = request.get_json()
        message = data.get('message', '').strip()

        if not message:
            return jsonify({"error": "Message cannot be empty"}), 400

        app.logger.info(f"Received message: {message[:50]}...")

        handler = PROVIDER_DISPATCHER.get(API_PROVIDER)
        if not handler:
            return jsonify({"error": "Invalid API provider configured"}), 400

        reply = handler(message)

        app.logger.info(f"Reply successfully generated from {API_PROVIDER}")

        return jsonify({
            "reply": reply,
            "provider": API_PROVIDER,
            "status": "success",
            "timestamp": datetime.utcnow().isoformat()
        })

    except requests.exceptions.RequestException as e:
        app.logger.error(f"Request error: {str(e)}")
        return jsonify({
            "error": "Service request failed",
            "status": "error",
            "timestamp": datetime.utcnow().isoformat()
        }), 502

    except Exception as e:
        app.logger.error(f"Error processing request: {str(e)}")
        return jsonify({
            "error": str(e),
            "provider": API_PROVIDER,
            "status": "error",
            "timestamp": datetime.utcnow().isoformat()
        }), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "provider": API_PROVIDER,
        "timestamp": datetime.utcnow().isoformat()
    })

if __name__ == '__main__':
    port = int(os.getenv("FLASK_PORT", 5000))
    debug_mode = os.getenv("FLASK_DEBUG", "false").lower() == "true"

    if os.getenv("PRODUCTION", "false").lower() == "true":
        from waitress import serve
        app.logger.info(f"Starting production server on port {port}")
        serve(app, host="0.0.0.0", port=port)
    else:
        app.logger.info(f"Starting development server on port {port}")
        app.run(host='0.0.0.0', port=port, debug=debug_mode)
