"""
api/routers/profile.py
-----------------------
Prefix: /admin
Routes:
  GET  /admin/profile — fetch business profile
  POST /admin/profile — create / update business profile
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..deps import get_tenant_db
from ....database import BusinessProfile
from ...schemas.models import BusinessProfileBase

router = APIRouter(prefix="/admin", tags=["Profile"])


@router.get("/profile", response_model=BusinessProfileBase)
async def get_profile(db: Session = Depends(get_tenant_db)):
    """Fetch the tenant's business profile, creating a blank one if absent."""
    profile = db.query(BusinessProfile).first()
    if not profile:
        profile = BusinessProfile(id="default")
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.post("/profile", response_model=BusinessProfileBase)
async def update_profile(
    profile_data: BusinessProfileBase,
    db: Session = Depends(get_tenant_db),
):
    """Create or fully replace the tenant's business profile."""
    profile = db.query(BusinessProfile).first()
    if not profile:
        profile = BusinessProfile(id="default")
        db.add(profile)

    # Core fields
    profile.company_name = profile_data.company_name
    profile.industry = profile_data.industry
    profile.business_description = profile_data.business_description
    profile.website = profile_data.website
    profile.support_email = profile_data.support_email
    profile.phone = profile_data.phone

    # Point of Contact
    profile.contact_person_name = profile_data.contact_person_name
    profile.contact_person_role = profile_data.contact_person_role
    profile.contact_person_email = profile_data.contact_person_email
    profile.contact_person_phone = profile_data.contact_person_phone

    # Location & Operations
    profile.address_street = profile_data.address_street
    profile.city = profile_data.city
    profile.state = profile_data.state
    profile.country = profile_data.country
    profile.zip_code = profile_data.zip_code
    profile.timezone = profile_data.timezone
    profile.business_hours = profile_data.business_hours

    # Branding & UI
    profile.brand_color_primary = profile_data.brand_color_primary
    profile.brand_color_secondary = profile_data.brand_color_secondary
    profile.social_linkedin = profile_data.social_linkedin
    profile.social_twitter = profile_data.social_twitter
    profile.social_instagram = profile_data.social_instagram

    profile.logo_url = profile_data.logo_url
    profile.chatbot_greeting_message = profile_data.chatbot_greeting_message
    profile.chatbot_system_prompt = profile_data.chatbot_system_prompt

    db.commit()
    db.refresh(profile)
    return profile
