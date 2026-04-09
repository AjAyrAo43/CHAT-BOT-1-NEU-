"""
app/core/rate_limiter.py
------------------------
Single Limiter instance shared by all routers.
Import `limiter` here — never create a second one.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
