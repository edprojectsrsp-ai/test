import os
import shutil

from fastapi import APIRouter, File, HTTPException, UploadFile

router = APIRouter(prefix="/upload", tags=["Uploads"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/{scheme_id}/documents")
async def upload_document(scheme_id: int, file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith((".pdf", ".png", ".jpg", ".jpeg")):
        raise HTTPException(status_code=400, detail="Only PDF and Images allowed")

    file_location = f"{UPLOAD_DIR}/scheme_{scheme_id}_{file.filename}"

    with open(file_location, "wb+") as file_object:
        shutil.copyfileobj(file.file, file_object)

    return {"info": f"file '{file.filename}' saved successfully", "url": file_location}
