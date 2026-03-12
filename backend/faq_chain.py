import os
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from dotenv import load_dotenv
from .database import get_tenant_session, FAQ, BusinessProfile, KnowledgeDocument

load_dotenv()


def get_faq_context(intent: str, tenant_id: str) -> str:
    """Get FAQ context from a specific tenant's database."""
    db = get_tenant_session(tenant_id)
    faqs = db.query(FAQ).filter(FAQ.intent == intent, FAQ.is_active == True).all()
    db.close()

    if not faqs:
        return "No specific FAQ found for this intent."

    context = ""
    for faq in faqs:
        context += f"Q: {faq.question}\nA: {faq.answer}\n\n"
    return context


def get_document_context(tenant_id: str) -> str:
    """Get context from uploaded Knowledge Documents."""
    db = get_tenant_session(tenant_id)
    docs = db.query(KnowledgeDocument).filter(KnowledgeDocument.is_active == True).all()
    db.close()

    if not docs:
        return ""

    context = "### UPLOADED KNOWLEDGE BASE DOCUMENTS:\n"
    for doc in docs:
        context += f"--- Document: {doc.filename} ---\n{doc.content}\n\n"
    return context


def get_answer(question: str, intent: str, tenant_id: str, language: str = "en") -> str:
    """Get AI answer using tenant-specific FAQs and business profile."""
    db = get_tenant_session(tenant_id)
    profile = db.query(BusinessProfile).first()
    db.close()

    company = profile.company_name if profile else "the company"
    industry = profile.industry if profile else "general services"
    desc = profile.business_description if profile else ""

    # Map language codes to full names
    lang_map = {
        "en": "English", "hi": "Hindi", "es": "Spanish", "fr": "French",
        "de": "German", "pt": "Portuguese", "ar": "Arabic", "zh": "Chinese",
        "ja": "Japanese", "ko": "Korean", "ru": "Russian", "it": "Italian",
        "nl": "Dutch", "tr": "Turkish", "bn": "Bengali", "ta": "Tamil",
        "te": "Telugu", "mr": "Marathi", "gu": "Gujarati", "kn": "Kannada",
    }
    lang_name = lang_map.get(language, "English")

    llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0.5)
    context = get_faq_context(intent, tenant_id)
    doc_context = get_document_context(tenant_id)

    system_prompt = (
        f"You are a strict customer support chatbot for {company} ({industry}). "
        f"Business Description: {desc}\n\n"
        "### ABSOLUTE RULES:\n"
        f"1. LANGUAGE: You MUST respond ONLY in {lang_name}. Translate your entire response into {lang_name}.\n"
        f"2. SCOPE: ONLY answer questions about {company} or the {industry} industry.\n"
        "3. NO HALLUCINATIONS: If the FAQ Context or Knowledge Base Documents below do not have the EXACT answer, you MUST NOT use your general LLM knowledge. You MUST NOT guess details like discounts, packs, or prices.\n"
        f"4. FALLBACK: For ANY question you cannot answer using the provided Contexts, you MUST respond with this exact phrase (translated into {lang_name}): 'I do apologize, but I do not have specific details on that right now. Please provide your Name, Phone Number, and Email address, and our support team will contact you shortly to provide the information you need.'\n"
        "5. VALIDATION: If the user provides their contact information, check for correctness:\n"
        "   - Phone Number: Must be a valid format (usually 10 digits). If it looks wrong (e.g., too short or just random letters), tell the user: 'The phone number provided seems incorrect. Could you please provide a valid 10-digit number?'\n"
        "   - Email: Must be a valid email format (e.g., name@example.com). If it is missing the '@' or has a typo in the domain (like 'gmiail.com'), politely ask them to correct it.\n"
        "6. FORMAT: Use short, professional bullet points.\n"
        "\n\nFAQ Context:\n{context}\n\n"
        "{doc_context}"
    )

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("human", "{question}")
    ])

    chain = prompt | llm
    response = chain.invoke({"question": question, "context": context, "doc_context": doc_context})
    return response.content.strip()


if __name__ == "__main__":
    # Test requires a valid tenant_id
    print("Use with a valid tenant_id: get_answer('question', 'intent', 'tenant_id')")
