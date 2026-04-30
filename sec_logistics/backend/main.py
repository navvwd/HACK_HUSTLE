from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from routers import auth_router, products_router, orders_router, claims_router, decisions_router, admin_router
from auth import require_role

app = FastAPI(title="sec_logistics - Adaptive Return Fraud Intelligence System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(products_router.router)
app.include_router(orders_router.router)
app.include_router(claims_router.router)
app.include_router(decisions_router.router)
app.include_router(admin_router.router)

@app.on_event("startup")
async def startup_event():
    await init_db()

@app.get("/")
async def root():
    return {"status": "sec_logistics API is running"}

# Example protected route
@app.get("/api/test-seller", dependencies=[Depends(require_role(["seller"]))])
async def test_seller_route():
    return {"message": "You are verified as a seller!"}

@app.get("/api/test-user", dependencies=[Depends(require_role(["user"]))])
async def test_user_route():
    return {"message": "You are verified as a user!"}
