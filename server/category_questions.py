"""
Category-specific question bank for the AI chatbot.
Each category+reason has a set of required and optional questions.
These are injected directly into the Gemini system prompt.
"""

QUESTION_BANK = {
    "electronics": {
        "damaged": [
            {"q": "Can you show me the serial number or IMEI of the device?", "type": "text", "required": True},
            {"q": "When did you first notice the damage? Was it on delivery or after use?", "type": "text", "required": True},
            {"q": "Can you describe the exact damage — cracked screen, dent, broken port?", "type": "text", "required": True},
            {"q": "Is the device still powering on?", "type": "text", "required": True},
            {"q": "Was the outer packaging also damaged when you received it?", "type": "text", "required": False},
        ],
        "defective": [
            {"q": "What exactly happens when you turn the device on?", "type": "text", "required": True},
            {"q": "Have you tried a factory reset or different power outlet?", "type": "text", "required": True},
            {"q": "When did the defect appear — on first use or after some time?", "type": "text", "required": True},
            {"q": "Are there any error messages or unusual sounds?", "type": "text", "required": False},
        ],
        "not_received": [
            {"q": "Can you confirm your delivery address is correct?", "type": "text", "required": True},
            {"q": "Did your neighbours or building security receive it?", "type": "text", "required": True},
            {"q": "Was an OTP requested at the time of delivery?", "type": "text", "required": True},
        ],
    },
    "apparel": {
        "damaged": [
            {"q": "Can you describe the defect — torn seam, stain, colour bleed?", "type": "text", "required": True},
            {"q": "Is the price tag or original packaging still attached?", "type": "text", "required": True},
            {"q": "Was the item washed or worn before you noticed the issue?", "type": "text", "required": True},
            {"q": "Can you describe the care label details?", "type": "text", "required": False},
        ],
        "wrong_item": [
            {"q": "What item did you receive instead of what you ordered?", "type": "text", "required": True},
            {"q": "Does the package label show your order ID?", "type": "text", "required": True},
            {"q": "Is the wrong item still in its original sealed packaging?", "type": "text", "required": True},
        ],
        "size_issue": [
            {"q": "What size did you order and what size did you receive?", "type": "text", "required": True},
            {"q": "Have you tried the item on? Is the tag still attached?", "type": "text", "required": True},
        ],
    },
    "appliances": {
        "damaged": [
            {"q": "What physical damage is visible? Please describe in detail.", "type": "text", "required": True},
            {"q": "Is the outer box or packaging also damaged?", "type": "text", "required": True},
            {"q": "Have you tried plugging it in?", "type": "text", "required": True},
            {"q": "Was the damage visible at the time of delivery?", "type": "text", "required": False},
        ],
        "defective": [
            {"q": "What happens when you turn it on?", "type": "text", "required": True},
            {"q": "Have you checked the voltage and power supply?", "type": "text", "required": True},
            {"q": "Was it working initially and then stopped, or defective from the start?", "type": "text", "required": True},
        ],
    },
    "beauty": {
        "damaged": [
            {"q": "Is the product seal or safety strip broken?", "type": "text", "required": True},
            {"q": "Was the packaging damaged or leaking when you received it?", "type": "text", "required": True},
            {"q": "Have you used the product?", "type": "text", "required": True},
        ],
    },
    "baby_products": {
        "damaged": [
            {"q": "What damage is visible on the product?", "type": "text", "required": True},
            {"q": "Was the packaging intact when delivered?", "type": "text", "required": True},
            {"q": "Is the product still safe to use in its current state?", "type": "text", "required": True},
        ],
    },
}

DEFAULT_QUESTIONS = [
    {"q": "Can you describe the issue you are experiencing with the product?", "type": "text", "required": True},
    {"q": "When did you first notice this issue?", "type": "text", "required": True},
    {"q": "Is the product in its original packaging?", "type": "text", "required": False},
]

def get_questions(category: str, reason: str) -> list:
    """Returns the list of questions for a given category and reason."""
    cat = QUESTION_BANK.get(category.lower(), {})
    return cat.get(reason.lower(), DEFAULT_QUESTIONS)

def build_system_prompt(category: str, reason: str, order_id: str, product_name: str = "") -> str:
    """Build the full Gemini system prompt with injected category questions."""
    questions = get_questions(category, reason)
    required_qs = [f"- {i+1}. {q['q']} {'(REQUIRED)' if q['required'] else '(optional)'}" for i, q in enumerate(questions)]
    questions_text = "\n".join(required_qs)

    return f"""You are ReturnGuard AI, a friendly and professional return claims assistant for an e-commerce platform.

The customer wants to return: **{product_name or 'their product'}** (Order ID: {order_id})
Return Reason Category: **{category}**
Specific Issue: **{reason}**

YOUR JOB:
1. Greet the customer warmly.
2. Ask each of the following questions ONE AT A TIME in a natural conversational way. Do NOT list all questions at once.
3. Wait for the customer's response before asking the next question.
4. After all required questions are answered, give a friendly confirmation summary.
5. Finally, output a JSON block (wrapped in ```json ... ```) with: {{"status": "complete", "summary": "...", "answers": {{...}}, "fraud_signals": ["...list any suspicious answers..."]}}

REQUIRED QUESTIONS FOR THIS RETURN:
{questions_text}

RULES:
- Be concise and friendly. This is a customer chat, not an interrogation.
- If a customer's answer seems contradictory or suspicious (e.g., "damaged but I washed it first"), note it in fraud_signals.
- Never mention fraud detection to the customer. Stay in character as a helpful assistant.
- Always ask required questions. Optional questions can be skipped if conversation flows naturally.
- Confirm the customer's identity with: "Just to confirm, you ordered [product] on [order_id] and you're reporting [reason]. Is that correct?"
"""
