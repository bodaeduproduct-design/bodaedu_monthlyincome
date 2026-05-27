from sqlalchemy import Column, Date, DateTime, Float, Integer, String, Text

from .database import Base


class DataSync(Base):
    __tablename__ = "data_syncs"

    id = Column(Integer, primary_key=True, index=True)
    source_name = Column(String(255), nullable=False)
    imported_at = Column(DateTime, nullable=False)
    notes = Column(Text, nullable=False, default="")


class TeacherSettlement(Base):
    __tablename__ = "teacher_settlements"

    id = Column(Integer, primary_key=True, index=True)
    month = Column(String(7), nullable=False, index=True)
    teacher_name = Column(String(120), nullable=False, index=True)
    student_count = Column(Integer, nullable=False, default=0)
    monthly_total_tuition = Column(Float, nullable=False, default=0.0)
    monthly_trial_amount = Column(Float, nullable=False, default=0.0)
    monthly_pretax_amount = Column(Float, nullable=False, default=0.0)
    session_total_tuition = Column(Float, nullable=False, default=0.0)
    session_trial_amount = Column(Float, nullable=False, default=0.0)
    session_pretax_amount = Column(Float, nullable=False, default=0.0)
    final_pretax_amount = Column(Float, nullable=False, default=0.0)
    final_aftertax_amount = Column(Float, nullable=False, default=0.0)
    settlement_date = Column(Date, nullable=True)


class MonthlySettlement(Base):
    __tablename__ = "monthly_settlements"

    id = Column(Integer, primary_key=True, index=True)
    month = Column(String(7), nullable=False, index=True)
    teacher_name = Column(String(120), nullable=False, index=True)
    student_count = Column(Integer, nullable=False, default=0)
    fee_rate = Column(Float, nullable=False, default=0.0)
    first_payment = Column(Float, nullable=False, default=0.0)
    recurring_payment = Column(Float, nullable=False, default=0.0)
    special_payment = Column(Float, nullable=False, default=0.0)
    refund_amount = Column(Float, nullable=False, default=0.0)
    long_term_payment = Column(Float, nullable=False, default=0.0)
    long_term_refund = Column(Float, nullable=False, default=0.0)
    total_tuition = Column(Float, nullable=False, default=0.0)
    trial_lesson_amount = Column(Float, nullable=False, default=0.0)
    pretax_amount = Column(Float, nullable=False, default=0.0)


class TuitionRecord(Base):
    __tablename__ = "tuition_records"

    id = Column(Integer, primary_key=True, index=True)
    sequence_no = Column(Integer, nullable=True)
    payment_method = Column(String(40), nullable=True)
    teacher_name = Column(String(120), nullable=False, index=True)
    phone = Column(String(80), nullable=True)
    email = Column(String(120), nullable=True)
    birth_date_text = Column(String(40), nullable=True)
    gender = Column(String(40), nullable=True)
    education = Column(String(120), nullable=True)
    major = Column(String(120), nullable=True)
    teaching_experience = Column(String(120), nullable=True)
    subject = Column(String(120), nullable=True)
    available_grades = Column(Text, nullable=True)


class TeacherProfile(Base):
    __tablename__ = "teacher_profiles"

    id = Column(Integer, primary_key=True, index=True)
    teacher_name = Column(String(120), nullable=False, unique=True, index=True)
    payment_method = Column(String(40), nullable=True)
    phone = Column(String(80), nullable=True)
    email = Column(String(120), nullable=True)
    birth_date_text = Column(String(40), nullable=True)
    gender = Column(String(40), nullable=True)
    education = Column(String(120), nullable=True)
    major = Column(String(120), nullable=True)
    teaching_experience = Column(String(120), nullable=True)
    subject = Column(String(120), nullable=True)
    available_grades = Column(Text, nullable=True)


class SessionSettlement(Base):
    __tablename__ = "session_settlements"

    id = Column(Integer, primary_key=True, index=True)
    month = Column(String(7), nullable=False, index=True)
    teacher_name = Column(String(120), nullable=False, index=True)
    student_count = Column(Integer, nullable=False, default=0)
    first_payment_count = Column(Integer, nullable=False, default=0)
    first_payment_fee = Column(Float, nullable=False, default=0.0)
    recurring_payment_count = Column(Integer, nullable=False, default=0)
    recurring_payment_fee = Column(Float, nullable=False, default=0.0)
    refund_payment_count = Column(Integer, nullable=False, default=0)
    refund_payment_fee = Column(Float, nullable=False, default=0.0)
    first_payment_commission = Column(Float, nullable=False, default=0.0)
    recurring_payment_commission = Column(Float, nullable=False, default=0.0)
    refund_payment_commission = Column(Float, nullable=False, default=0.0)


class SessionCollection(Base):
    __tablename__ = "session_collections"

    id = Column(Integer, primary_key=True, index=True)
    month = Column(String(7), nullable=False, index=True)
    row_number = Column(Integer, nullable=True)
    payment_method = Column(String(40), nullable=True)
    teacher_name = Column(String(120), nullable=False, index=True)
    student_name = Column(String(120), nullable=True)
    commission_rate = Column(Float, nullable=False, default=0.0)
    course = Column(String(80), nullable=True)
    weekly_frequency = Column(String(80), nullable=True)
    weekdays = Column(String(80), nullable=True)
    time_text = Column(String(80), nullable=True)
    product_name = Column(String(120), nullable=True)
    current_month_sessions = Column(Integer, nullable=False, default=0)
    current_month_amount = Column(Float, nullable=False, default=0.0)
    trial_lesson_date = Column(Date, nullable=True)
    lesson_start_date = Column(Date, nullable=True)
    lesson_end_date = Column(Date, nullable=True)


class StudentRecord(Base):
    __tablename__ = "student_records"

    id = Column(Integer, primary_key=True, index=True)
    student_name = Column(String(120), nullable=False, unique=True, index=True)
    parent_name = Column(String(120), nullable=True)
    contact = Column(String(80), nullable=True)
    status = Column(String(40), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)


class StudentEvent(Base):
    __tablename__ = "student_events"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, nullable=False, index=True)
    event_date = Column(Date, nullable=True)
    event_type = Column(String(40), nullable=False)
    title = Column(String(160), nullable=False)
    teacher_name = Column(String(120), nullable=True)
    payment_method = Column(String(40), nullable=True)
    weekly_frequency = Column(String(80), nullable=True)
    weekdays = Column(String(80), nullable=True)
    time_text = Column(String(80), nullable=True)
    product_name = Column(String(120), nullable=True)
    amount = Column(Float, nullable=True)
    memo = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)


class ProductPrice(Base):
    __tablename__ = "product_prices"

    id = Column(Integer, primary_key=True, index=True)
    table_name = Column(String(80), nullable=False, index=True)
    product_name = Column(String(120), nullable=False)
    amount = Column(Float, nullable=False, default=0.0)


class RateTableRow(Base):
    __tablename__ = "rate_table_rows"

    id = Column(Integer, primary_key=True, index=True)
    section_name = Column(String(80), nullable=False, default="")
    row_type = Column(String(20), nullable=False, default="data")
    row_label = Column(String(120), nullable=False, default="")
    value_1 = Column(String(80), nullable=True)
    value_2 = Column(String(80), nullable=True)
    value_3 = Column(String(80), nullable=True)
    value_4 = Column(String(80), nullable=True)
    value_5 = Column(String(80), nullable=True)
    value_6 = Column(String(80), nullable=True)
    row_order = Column(Integer, nullable=False, default=0)
