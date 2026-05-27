from __future__ import annotations

from datetime import date
from typing import Any, List, Optional

from pydantic import BaseModel, Field


class ImportResponse(BaseModel):
    imported_count: int
    source_name: str
    available_months: List[str]


class StudentRecordCreate(BaseModel):
    student_name: str = Field(..., min_length=1, max_length=120)
    parent_name: Optional[str] = Field(default=None, max_length=120)
    contact: Optional[str] = Field(default=None, max_length=80)
    payment_method: Optional[str] = Field(default=None, max_length=40)
    status: Optional[str] = Field(default=None, max_length=40)
    notes: Optional[str] = Field(default=None, max_length=2000)


class StudentRecordUpdate(BaseModel):
    student_name: str = Field(..., min_length=1, max_length=120)
    parent_name: Optional[str] = Field(default=None, max_length=120)
    contact: Optional[str] = Field(default=None, max_length=80)
    payment_method: Optional[str] = Field(default=None, max_length=40)
    status: Optional[str] = Field(default=None, max_length=40)
    notes: Optional[str] = Field(default=None, max_length=2000)


class StudentEventCreate(BaseModel):
    event_date: Optional[date] = None
    event_type: str = Field(..., min_length=1, max_length=40)
    title: str = Field(..., min_length=1, max_length=160)
    teacher_name: Optional[str] = Field(default=None, max_length=120)
    payment_method: Optional[str] = Field(default=None, max_length=40)
    weekly_frequency: Optional[str] = Field(default=None, max_length=80)
    weekdays: Optional[str] = Field(default=None, max_length=80)
    time_text: Optional[str] = Field(default=None, max_length=80)
    product_name: Optional[str] = Field(default=None, max_length=120)
    amount: Optional[float] = None
    memo: Optional[str] = Field(default=None, max_length=2000)


class StudentEventUpdate(StudentEventCreate):
    pass


class EnrollmentScheduleCreate(BaseModel):
    effective_from: date
    course: Optional[str] = Field(default=None, max_length=80)
    weekly_frequency: Optional[str] = Field(default=None, max_length=80)
    weekdays: Optional[str] = Field(default=None, max_length=80)
    time_text: Optional[str] = Field(default=None, max_length=80)


class AdminRowPayload(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)
