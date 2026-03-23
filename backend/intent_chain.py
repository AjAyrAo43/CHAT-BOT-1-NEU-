import os
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from dotenv import load_dotenv

from .database import get_tenant_session, BusinessProfile

load_dotenv()


def detect_intent(question: str, tenant_id: str = None, db=None) -> str:
    """Detect intent from user question. If tenant_id is provided, uses tenant's business profile for context."""
    company = "the company"
    industry = "general services"

    if tenant_id:
        try:
            should_close = False
            if db is None:
                db = get_tenant_session(tenant_id)
                should_close = True
            
            profile = db.query(BusinessProfile).first()
            if should_close:
                db.close()
                
            if profile:
                company = profile.company_name
                industry = profile.industry
        except Exception:
            pass  # Fallback to defaults if tenant DB not available

    # Use llama-3.1-8b-instant for maximum speed
    llm = ChatGroq(model="llama-3.1-8b-instant", temperature=0)

    system_prompt = (
        f"You are an intent detection bot for {company}, a business in the {industry} industry. "
        "Classify the following user question into exactly one of these categories: "
        "pricing, service_inquiry, support, contact, information, eligibility. "
        "If the question is in Hindi or Hinglish, still classify it into one of these categories. "
        "Return only the category name in lowercase."
    )

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("human", "{question}")
    ])

    chain = prompt | llm
    response = chain.invoke({"question": question})
    return response.content.strip().lower()


if __name__ == "__main__":
    test_q = "what is your price?"
    print(f"Question: {test_q}")
    print(f"Intent: {detect_intent(test_q)}")
