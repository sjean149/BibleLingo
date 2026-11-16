import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import User, UserProgressState
from app.schemas import ProgressIn, ProgressOut
from app.services.progress_merge import merge_progress

router = APIRouter(prefix="/progress", tags=["progress"])

# A learner's whole progress is a few kilobytes even after the whole New Testament;
# anything far bigger is not from the app.
MAX_BYTES = 200_000


@router.get("", response_model=ProgressOut)
def get_progress(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The signed-in learner's saved progress, or data=null if they have never saved any."""
    row = db.get(UserProgressState, user.id)
    return ProgressOut(data=row.data if row else None, updated_at=row.updated_at if row else None)


@router.put("", response_model=ProgressOut)
def save_progress(body: ProgressIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Merge a device's progress into the account (or store it as is with replace=true, after a
    reset) and return the combined copy, which the device then merges back in. Merging on the
    server means two devices saving at once can't wipe out each other's steps.
    """
    if len(json.dumps(body.data)) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Progress data is too large")

    row = db.get(UserProgressState, user.id)
    if row is None:
        row = UserProgressState(user_id=user.id, data=merge_progress({}, body.data))
        db.add(row)
    else:
        row.data = merge_progress({}, body.data) if body.replace else merge_progress(row.data, body.data)
    db.commit()
    db.refresh(row)
    return ProgressOut(data=row.data, updated_at=row.updated_at)
