from setuptools import setup, find_packages

def read_requirements():
    with open("requirements.txt", "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip() and not line.startswith("#")]

setup(
    name="chatbot-neu",
    version="0.1.0",
    description="A domain-specific multi-tenant chatbot project",
    author="Ajay",
    packages=find_packages(),
    install_requires=read_requirements(),
    python_requires=">=3.9",
    entry_points={
        "console_scripts": [
            "run-chatbot=run_all:main",
        ]
    },
)
