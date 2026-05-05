from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
import os
from dotenv import load_dotenv
import json
from pytrends.request import TrendReq
import pandas as pd

load_dotenv()

# Configure Gemini API
GEMINI_KEYS = [
    os.getenv("GEMINI_API_KEY_1"),
    os.getenv("GEMINI_API_KEY_2")
]
GEMINI_KEYS = [k for k in GEMINI_KEYS if k] # Filter out None

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GEMINI_KEYS:
    print("WARNING: No Gemini API keys found in environment variables.")

if not GROQ_API_KEY:
    print("WARNING: GROQ_API_KEY not found in environment variables.")

def configure_gemini(key_index=0):
    if key_index < len(GEMINI_KEYS):
        genai.configure(api_key=GEMINI_KEYS[key_index])
        return True
    return False

# Initial configuration
configure_gemini(0)

app = FastAPI()

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Temporarily allow all for debugging
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalysisRequest(BaseModel):
    query: str

import requests

import asyncio

# Persistent Cache Logic
CACHE_FILE_AI = "ai_cache.json"
CACHE_FILE_IMAGE = "image_cache.json"
CACHE_FILE_SERPER = "serper_cache.json" # Cache for product results

def load_json_cache(filename):
    if os.path.exists(filename):
        try:
            with open(filename, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading cache {filename}: {e}")
    return {}

def save_json_cache(filename, data):
    try:
        with open(filename, "w") as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        print(f"Error saving cache {filename}: {e}")

# Load existing caches on startup
ai_cache = load_json_cache(CACHE_FILE_AI)
image_cache = load_json_cache(CACHE_FILE_IMAGE)
serper_cache = load_json_cache(CACHE_FILE_SERPER)

import hashlib

def get_image_hash(image_bytes: bytes):
    """Generate a unique MD5 hash for the image to use as a cache key."""
    return hashlib.md5(image_bytes).hexdigest()

async def get_ai_completion(prompt: str, is_json: bool = False):
    """Unified function with Caching and Gemini -> Ollama fallback."""
    # Normalize query for cache
    cache_key = prompt.strip().lower()
    
    # 1. Check Cache
    if cache_key in ai_cache:
        print(f"Returning cached response for: {cache_key}")
        return ai_cache[cache_key], "Cache"

    # 2. Try Gemini Keys in order (Prioritizing Key 1 for Text)
    text_keys_order = [0, 1] if len(GEMINI_KEYS) > 1 else [0]
    for i in text_keys_order:
        try:
            configure_gemini(i)
            print(f"Attempting Text Analysis with Gemini Key {i+1}...")
            
            model_name = 'gemini-2.5-flash'
            model = genai.GenerativeModel(model_name)
            
            # Wrap the synchronous Gemini call in a thread with a timeout
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    model.generate_content,
                    prompt,
                    generation_config=genai.types.GenerationConfig(
                        max_output_tokens=1000 if is_json else 100,
                        temperature=0.7
                    )
                ),
                timeout=8.0
            )
            
            text = response.text.strip()
            
            if is_json:
                # Robust JSON cleaning
                clean_text = text
                if "```json" in clean_text:
                    clean_text = clean_text.split("```json")[1].split("```")[0].strip()
                elif "```" in clean_text:
                    clean_text = clean_text.split("```")[1].split("```")[0].strip()
                
                try:
                    result = json.loads(clean_text)
                except json.JSONDecodeError as e:
                    print(f"JSON Decode Error on Gemini Key {i+1}: {e}. Text: {clean_text[:100]}...")
                    # Try a more aggressive cleanup if simple one fails
                    import re
                    json_match = re.search(r'\{.*\}', clean_text, re.DOTALL)
                    if json_match:
                        result = json.loads(json_match.group())
                    else:
                        raise e

                ai_cache[cache_key] = result
                save_json_cache(CACHE_FILE_AI, ai_cache) # Save to disk
                return result, f"Gemini (Key {i+1})"
            
            ai_cache[cache_key] = text
            save_json_cache(CACHE_FILE_AI, ai_cache) # Save to disk
            return text, f"Gemini (Key {i+1})"
            
        except asyncio.TimeoutError:
            print(f"Gemini Key {i+1} timed out.")
        except Exception as gemini_err:
            print(f"Gemini Key {i+1} error: {str(gemini_err)}")
            await asyncio.sleep(3)
            continue

    # 2. Fallback to Ollama
    try:
        print(f"All Gemini keys exhausted. Waiting 3s then attempting Ollama fallback...")
        await asyncio.sleep(3)
        ollama_response = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": "llama3.2:latest",
                "prompt": f"You are a retail expert. Output ONLY valid JSON for this prompt: {prompt}" if is_json else prompt,
                "stream": False,
                "format": "json" if is_json else ""
            },
            timeout=30 # Increased timeout for local LLM analysis
        )
        if ollama_response.status_code == 200:
            result = ollama_response.json().get("response", "")
            if is_json:
                result_json = json.loads(result)
                ai_cache[cache_key] = result_json
                save_json_cache(CACHE_FILE_AI, ai_cache) # Save to disk
                return result_json, "Ollama"
            ai_cache[cache_key] = result
            save_json_cache(CACHE_FILE_AI, ai_cache) # Save to disk
            return result, "Ollama"
        else:
            print(f"Ollama returned error: {ollama_response.status_code}")
    except Exception as ollama_err:
        print(f"Ollama also failed: {str(ollama_err)}")
    
    raise HTTPException(status_code=500, detail="Both AI services (Gemini & Ollama) are currently unavailable. Please try again in a few minutes.")

SERPER_API_KEY = os.getenv("SERPER_API_KEY")

async def get_real_products(query: str):
    """Fetch real products with images and links using Serper."""
    if not SERPER_API_KEY:
        return []
    
    # Check Cache
    cache_key = query.strip().lower()
    if cache_key in serper_cache:
        print(f"Returning cached Serper results for: {cache_key}")
        return serper_cache[cache_key]

    try:
        url = "https://google.serper.dev/shopping"
        payload = json.dumps({"q": query, "gl": "in", "location": "India"})
        headers = { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }
        response = requests.post(url, headers=headers, data=payload, timeout=10)
        if response.status_code == 200:
            results = response.json().get("shopping", [])[:4] # Top 4 products
            products = []
            for item in results:
                products.append({
                    "title": item.get("title", ""),
                    "price": item.get("price", "N/A"),
                    "link": item.get("link", "#"),
                    "image": item.get("imageUrl", ""),
                    "source": item.get("source", "Retailer")
                })
            
            # Save to Cache
            serper_cache[cache_key] = products
            save_json_cache(CACHE_FILE_SERPER, serper_cache)
            
            return products
    except Exception as e:
        print(f"Serper Product Error: {str(e)}")
    return []

@app.post("/analyze")
async def analyze_trend(request: AnalysisRequest):
    print(f"Received Analysis Request for: {request.query}")
    # 1. Fetch real products
    try:
        products = await get_real_products(request.query)
        print(f"Fetched {len(products)} products from Serper")
    except Exception as e:
        print(f"Serper error: {e}")
        products = []

    price_context = "; ".join([f"{p['title']} ({p['price']})" for p in products])
    
    # 2. Build Prompt
    prompt = f"""
    You are an expert retail trend analyst for the Indian market.
    Analyze the query: "{request.query}" and return the response in a VALID JSON format.
    
    REAL-TIME MARKET PRICING:
    {price_context}
    
    CRITICAL: All fields must be human-readable strings.
    
    Expected JSON Keys:
    1. current_trends: (string)
    2. upcoming_trends: (string)
    3. popular_products: (string)
    4. budget_suggestions: (string) Summarize the pricing for these products in Rupees.
    5. growth_reason: (string)
    6. chart_data: (list of 5 integers)

    Ensure the output is ONLY the JSON object.
    """
    data, source = await get_ai_completion(prompt, is_json=True)
    
    if isinstance(data, dict):
        data["source"] = source
        data["real_products"] = products # Pass real products to frontend
    return data

from fastapi import File, UploadFile, Form

import base64

async def prepare_image_for_ai(file: UploadFile):
    """
    Converter function:
    Gemini needs -> binary (bytes)
    Ollama needs -> base64 string
    """
    image_bytes = await file.read()
    base64_string = base64.b64encode(image_bytes).decode('utf-8')
    return image_bytes, base64_string, file.content_type

@app.post("/analyze-image")
async def analyze_image(
    file: UploadFile = File(...),
    query: str = Form("Analyze the trend in this image")
):
    # Use the converter function
    image_bytes, base64_image, mime_type = await prepare_image_for_ai(file)
    
    # 0. Check Image Cache
    image_hash = get_image_hash(image_bytes)
    if image_hash in image_cache:
        print(f"Returning cached results for image: {image_hash}")
        return image_cache[image_hash]

    # 1. Try Gemini Vision Keys (Prioritizing Key 2 for Images as requested)
    vision_keys_order = [1, 0] if len(GEMINI_KEYS) > 1 else [0]
    for i in vision_keys_order:
        try:
            configure_gemini(i)
            print(f"Attempting Gemini 2.5 Flash Vision with Key {i+1}...")
            
            prompt = f"""
            You are an expert retail trend analyst for the Indian market.
            
            TASK:
            1. FIRST, verify if the image is related to fashion, retail, clothing, jewelry, or lifestyle trends.
            2. IF the image is purely text or unrelated to the retail domain, return "is_valid": false.
            3. IF valid, identify the specific product. 
               CRITICAL: Distinguish between FINISHED PRODUCTS (e.g., a gold necklace, a dress) and RAW MATERIALS (e.g., rope, thread, raw fabric). 
               If you see metallic shine, clasps, or ornate links, it is likely JEWELRY, not rope or thread.
            
            Analyze based on this context: "{query}" and return the standard JSON.

            Return JSON format:
            {{
                "is_valid": (boolean),
                "error": (string, only if is_valid is false),
                "current_trends": (string) Be specific (e.g., "Heavy Gold Men's Chain" instead of "Jewelry"),
                "upcoming_trends": (string),
                "popular_products": (string) Mention specific items related to the identified product,
                "budget_suggestions": (string),
                "growth_reason": (string),
                "chart_data": (list of 5 integers)
            }}

            Ensure the output is ONLY the JSON object.
            """
            
            model = genai.GenerativeModel('gemini-2.5-flash')
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    model.generate_content,
                    [prompt, {"mime_type": mime_type, "data": image_bytes}]
                ),
                timeout=12.0 # Slightly longer for vision
            )
            
            text = response.text.strip()
            # Robust JSON cleaning
            clean_text = text
            if "```json" in clean_text:
                clean_text = clean_text.split("```json")[1].split("```")[0].strip()
            elif "```" in clean_text:
                clean_text = clean_text.split("```")[1].split("```")[0].strip()
            
            try:
                data = json.loads(clean_text)
            except json.JSONDecodeError:
                import re
                json_match = re.search(r'\{.*\}', clean_text, re.DOTALL)
                if json_match:
                    data = json.loads(json_match.group())
                else:
                    raise
                
            data["source"] = f"Gemini 2.5 Flash (Key {i+1})"
            
            # Now fetch real products based on the identified trend
            search_query = data.get("current_trends", query)
            data["real_products"] = await get_real_products(search_query)
            
            # Save to Cache (with Source marked as Cache for next time)
            cached_data = data.copy()
            cached_data["source"] = "Cache"
            image_cache[image_hash] = cached_data
            save_json_cache(CACHE_FILE_IMAGE, image_cache) # Save to disk
            
            return data
            
        except asyncio.TimeoutError:
            print(f"Gemini Vision Key {i+1} timed out.")
        except Exception as e:
            print(f"Gemini Vision Key {i+1} failed: {str(e)}")
            print(f"Waiting 3s before next attempt...")
            await asyncio.sleep(3)
            continue

    # 2. Fallback to Ollama Vision
    try:
        print("All Gemini Vision keys failed. Waiting 3s then attempting Moondream Vision fallback...")
        await asyncio.sleep(3)
        ollama_prompt = f"Analyze this fashion image. Use ONLY descriptive strings (no coordinates or numbers). If NOT fashion/retail, return JSON with is_valid: false, error: 'Incorrect image: Please upload an image related to retail fashion.'. If it IS fashion, return JSON with is_valid: true, current_trends: 'description string', upcoming_trends: 'description string', popular_products: 'item list', budget_suggestions: 'price string', growth_reason: 'reason string', chart_data: [5 ints]. Context: {query}"
        
        ollama_response = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": "moondream",
                "prompt": ollama_prompt,
                "images": [base64_image],
                "stream": False,
                "format": "json"
            },
            timeout=90 # Increased for first-time loading
        )
        
        if ollama_response.status_code == 200:
            result = ollama_response.json().get("response", "")
            data = json.loads(result)
            data["source"] = "Ollama (Moondream)"
            
            # Fetch real products based on identified trend
            search_query = data.get("current_trends", query)
            data["real_products"] = await get_real_products(search_query)
            
            # Save to Cache
            cached_data = data.copy()
            cached_data["source"] = "Cache"
            image_cache[image_hash] = cached_data
            save_json_cache(CACHE_FILE_IMAGE, image_cache) # Save to disk
            
            return data
        else:
            print(f"Ollama Moondream returned status: {ollama_response.status_code}")
            
    except Exception as ollama_err:
        print(f"Ollama Vision (Moondream) failed: {str(ollama_err)}")
        
    raise HTTPException(status_code=500, detail="Image analysis failed on both cloud and local AI. Please ensure Ollama is running.")

@app.post("/trend-graph")
async def get_real_trends(request: AnalysisRequest):
    try:
        pytrends = TrendReq(hl='en-US', tz=360, timeout=(10, 25)) 
        
        # We start with a slightly broad keyword to ensure a "proper" graph
        # instead of a sparse one with many zeros.
        keywords = request.query.split()
        if len(keywords) > 2:
            search_term = " ".join(keywords[:2]) # Use first 2 words for better data density
        else:
            search_term = request.query
            
        kw_list = [search_term]
        pytrends.build_payload(kw_list, cat=0, timeframe='today 5-y', geo='IN')
        df = pytrends.interest_over_time()
        
        # If the graph is still mostly zeros, use the most basic keyword (first word)
        if not df.empty and search_term in df:
            zero_count = (df[search_term] == 0).sum()
            if zero_count > (len(df) * 0.7): # If 70% is zero, it's a "bad" graph
                search_term = keywords[0]
                pytrends.build_payload([search_term], cat=0, timeframe='today 5-y', geo='IN')
                df = pytrends.interest_over_time()

        if df.empty or search_term not in df:
            return {"labels": [], "values": [], "term_used": search_term}
            
        # Resample to monthly to make the graph smoother and more "proper"
        df_monthly = df.resample('ME').mean()
        
        labels = [d.strftime('%b %Y') for d in df_monthly.index][-24:] # Last 24 months
        values = [int(v) for v in df_monthly[search_term]][-24:]
        
        return {
            "labels": labels,
            "values": values,
            "term_used": search_term
        }
    except Exception as e:
        print(f"Pytrends Error (likely 429): {str(e)}")
        # Return empty data instead of 500 error
        return {
            "labels": ["Data Unavailable"],
            "values": [0],
            "error": "Google Trends rate limit reached. Try again later.",
            "term_used": request.query
        }

async def get_groq_completion(prompt: str):
    """Chatbot-specific function using Groq with Llama3 fallback and final Gemini safety net."""
    # Current active Groq model IDs
    models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
    
    for model in models:
        try:
            print(f"Attempting Chat with Groq Model: {model}...")
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": "You are AI Retail Trend Analyzer Assistant, a specialized retail and fashion expert for the Indian market. You MUST ONLY answer questions related to retail, fashion, shopping, jewelry, and lifestyle trends. If a user asks anything else (e.g., math, coding, politics, general knowledge), politely refuse and state that you are only trained for retail and fashion assistance. Max 2 sentences."},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.7,
                "max_tokens": 150
            }
            
            response = await asyncio.to_thread(
                requests.post, 
                url, 
                headers=headers, 
                json=payload, 
                timeout=10
            )
            
            if response.status_code == 200:
                result = response.json()
                return result["choices"][0]["message"]["content"], f"Groq ({model})"
            else:
                print(f"Groq {model} failed with status: {response.status_code}")
        except Exception as e:
            print(f"Groq {model} error: {str(e)}")
        
        await asyncio.sleep(1) # Reduced switch time for better UX during error

    # Final Fallback to Gemini if Groq is down
    print("Groq failed. Falling back to Gemini for chatbot...")
    try:
        gemini_prompt = (
            "You are AI Retail Trend Analyzer Assistant, a specialized retail and fashion expert for India. "
            "You MUST ONLY answer questions related to retail, fashion, jewelry, and lifestyle trends. "
            "If the user asks about anything else (math, coding, general facts), politely refuse and say you are a retail expert. "
            f"Max 2 sentences.\nUser: {prompt}"
        )
        response_text, source = await get_ai_completion(gemini_prompt)
        return response_text, f"{source} (Groq Fallback)"
    except:
        return None, None

@app.post("/chat")
async def retail_chat(request: AnalysisRequest):
    response_text, source = await get_groq_completion(request.query)
    
    if not response_text:
        # Final fallback if Groq completely fails
        return {"response": "I'm having trouble connecting to my brain. Please try again in a moment.", "source": "System Error"}
        
    return {"response": response_text, "source": source}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
