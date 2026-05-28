from __future__ import annotations

from sqlalchemy import Column, Float, ForeignKey, Integer, String, Text

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, nullable=True, unique=True)
    name = Column(String, nullable=False)
    role = Column(String, nullable=False)  # 'teacher' | 'student'
    created_at = Column(String, nullable=True)


class StudentProfile(Base):
    __tablename__ = "student_profiles"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    phone = Column(String, nullable=True)
    region = Column(String, nullable=True)
    grade_level = Column(String, nullable=True)
    parent_name = Column(String, nullable=True)
    parent_phone = Column(String, nullable=True)
    created_at = Column(String, nullable=True)


class TeacherProfile(Base):
    __tablename__ = "teacher_profiles"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    phone = Column(String, nullable=True)
    birth_date = Column(String, nullable=True)
    gender = Column(String, nullable=True)
    education = Column(String, nullable=True)
    major = Column(String, nullable=True)
    status = Column(String, nullable=True, default="active")
    status_changed_at = Column(String, nullable=True)
    created_at = Column(String, nullable=True)


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    level = Column(String, nullable=False)
    sessions_per_week = Column(Integer, nullable=False)
    duration_min = Column(Integer, nullable=False)
    price_standard = Column(Integer, nullable=True)
    price_17 = Column(Integer, nullable=True)
    price_35 = Column(Integer, nullable=True)
    price_per_session = Column(Integer, nullable=True)
    billing_unit = Column(String, nullable=False, default="monthly")
    is_active = Column(Integer, nullable=True, default=1)
    created_at = Column(String, nullable=True)


class LessonEnrollment(Base):
    """학생↔선생님 수업(배정·계약). 예전 이름: subscriptions."""

    __tablename__ = "lesson_enrollments"

    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    price_type = Column(String, nullable=True)
    payment_method = Column(String, nullable=True)
    day_1 = Column(Integer, nullable=True)
    day_2 = Column(Integer, nullable=True)
    day_3 = Column(Integer, nullable=True)
    base_commission_rate = Column(Float, nullable=False, default=60.0)
    current_commission_rate = Column(Float, nullable=False, default=60.0)
    trial_date = Column(String, nullable=True)
    trial_month = Column(String, nullable=True)
    trial_fee = Column(Integer, nullable=True, default=0)
    start_date = Column(String, nullable=True)
    end_date = Column(String, nullable=True)
    next_billing = Column(String, nullable=True)
    first_month_sessions = Column(Integer, nullable=True)
    first_month_ratio = Column(Float, nullable=True)
    first_month_amount = Column(Integer, nullable=True)
    cancelled_at = Column(String, nullable=True)
    termination_total_sessions = Column(Integer, nullable=True)
    termination_remaining = Column(Integer, nullable=True)
    termination_ratio = Column(Float, nullable=True)
    created_at = Column(String, nullable=True)


class MonthlyPaymentRecord(Base):
    """월별 학생 수납 내역. 예전 이름: monthly_lesson_records."""

    __tablename__ = "monthly_payment_records"

    id = Column(Integer, primary_key=True)
    billing_month = Column(String, nullable=False)
    enrollment_id = Column(Integer, ForeignKey("lesson_enrollments.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    total_sessions = Column(Integer, nullable=True, default=0)
    completed_sessions = Column(Integer, nullable=True, default=0)
    billing_unit = Column(String, nullable=True)
    base_amount = Column(Integer, nullable=True, default=0)
    special_amount = Column(Integer, nullable=True, default=0)
    refund_amount = Column(Integer, nullable=True, default=0)
    final_amount = Column(Integer, nullable=True, default=0)
    commission_rate = Column(Float, nullable=True)
    payment_status = Column(String, nullable=True, default="paid")
    payment_tag = Column(String, nullable=True)
    memo = Column(Text, nullable=True)


class Settlement(Base):
    __tablename__ = "settlements"

    id = Column(Integer, primary_key=True)
    billing_month = Column(String, nullable=False)
    teacher_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    settlement_type = Column(String, nullable=False)
    gross_amount = Column(Integer, nullable=False, default=0)
    trial_fee = Column(Integer, nullable=True, default=0)
    commission_rate = Column(Float, nullable=False)
    pre_tax_amount = Column(Integer, nullable=False, default=0)
    withholding_rate = Column(Float, nullable=True, default=3.30)
    withholding_amount = Column(Integer, nullable=False, default=0)
    net_amount = Column(Integer, nullable=False, default=0)
    status = Column(String, nullable=True, default="pending")
    settled_at = Column(String, nullable=True)


class RefundRequest(Base):
    __tablename__ = "refund_requests"

    id = Column(Integer, primary_key=True)
    enrollment_id = Column(Integer, ForeignKey("lesson_enrollments.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("student_profiles.id"), nullable=False)
    billing_month = Column(String, nullable=False)
    reason_type = Column(String, nullable=True)
    reason_detail = Column(Text, nullable=True)
    total_sessions = Column(Integer, nullable=True)
    completed_sessions = Column(Integer, nullable=True)
    progress_rate = Column(Float, nullable=True)
    paid_amount = Column(Integer, nullable=False)
    refund_rate = Column(Float, nullable=True)
    refund_amount = Column(Integer, nullable=False)
    status = Column(String, nullable=True, default="pending")
    requested_at = Column(String, nullable=True)
    approved_at = Column(String, nullable=True)
    completed_at = Column(String, nullable=True)


class CommissionRateHistory(Base):
    __tablename__ = "commission_rate_history"

    id = Column(Integer, primary_key=True)
    enrollment_id = Column(Integer, ForeignKey("lesson_enrollments.id"), nullable=False)
    previous_rate = Column(Float, nullable=False)
    new_rate = Column(Float, nullable=False)
    changed_month = Column(String, nullable=False)
    reason = Column(Text, nullable=True)
    created_at = Column(String, nullable=True)


# 코드 호환용 별칭 (점진 제거)
Subscription = LessonEnrollment
MonthlyLessonRecord = MonthlyPaymentRecord
