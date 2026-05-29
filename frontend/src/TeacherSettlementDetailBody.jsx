export default function TeacherSettlementDetailBody({ detail, formatCurrency }) {
  if (!detail) return null

  const monthlyRows = detail.regular_monthly_payments ?? []
  const perSessionRows = detail.regular_per_session_payments ?? []
  const trialRows = detail.trial_lessons ?? []

  return (
    <div className="teacher-detail-modal">
      {detail.payout_flow ? (
        <>
          <section className="teacher-payout-total teacher-payout-total--plain">
            <div className="teacher-payout-total__main">
              <span>최종 정산 금액</span>
              <strong>{formatCurrency(detail.payout_flow.total?.net_amount)}</strong>
              <p className="teacher-payout-total__hint">
                세전 {formatCurrency(detail.payout_flow.total?.pre_tax_amount)}
              </p>
            </div>
          </section>

          <div className="teacher-payout-summary-row">
            <section className="teacher-payout-summary-card">
              <span>정규 수업료 (세전)</span>
              <strong>{formatCurrency(detail.payout_flow.regular?.teacher_share_pre_tax)}</strong>
            </section>
            <section className="teacher-payout-summary-card">
              <span>시범 수업료 (세전)</span>
              <strong>{formatCurrency(detail.payout_flow.trial?.teacher_share_pre_tax)}</strong>
            </section>
          </div>
        </>
      ) : null}

      <section className="teacher-detail-block teacher-detail-block--flat">
        <div className="teacher-detail-block__header">
          <h4>월별 수업</h4>
          <span>{monthlyRows.length}건</span>
        </div>
        {monthlyRows.length === 0 ? (
          <div className="empty-state compact">해당 월 월별 수금 학생이 없습니다.</div>
        ) : (
          <div className="table-wrap">
            <table className="settlement-overview-table">
              <thead>
                <tr>
                  <th>학생</th>
                  <th>상품</th>
                  <th>수납액</th>
                  <th>수수료율</th>
                  <th>정산 수업료 (세전)</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.student_name ?? `학생#${row.student_id}`}</td>
                    <td>{row.product_name ?? '-'}</td>
                    <td>{formatCurrency(row.final_amount)}</td>
                    <td>{row.commission_rate != null ? `${row.commission_rate}%` : '-'}</td>
                    <td>
                      <strong>
                        {formatCurrency(row.teacher_share_pre_tax ?? row.teacher_share ?? row.final_amount)}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="teacher-detail-block teacher-detail-block--flat teacher-detail-block--per-session">
        <div className="teacher-detail-block__header">
          <h4>회차별 수업</h4>
          <span>{perSessionRows.length}건</span>
        </div>
        {perSessionRows.length === 0 ? (
          <div className="empty-state compact">해당 월 회당 수금 학생이 없습니다.</div>
        ) : (
          <div className="table-wrap">
            <table className="settlement-overview-table">
              <thead>
                <tr>
                  <th>학생</th>
                  <th>상품</th>
                  <th>예정</th>
                  <th>이월</th>
                  <th>진행</th>
                  <th>정산 수납액</th>
                  <th>수수료율</th>
                  <th>정산 수업료 (세전)</th>
                </tr>
              </thead>
              <tbody>
                {perSessionRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.student_name ?? `학생#${row.student_id}`}</td>
                    <td>{row.product_name ?? '-'}</td>
                    <td>{row.total_sessions ?? 0}</td>
                    <td
                      className={
                        (row.carryover_delta ?? 0) > 0
                          ? 'carryover-delta carryover-delta--plus'
                          : (row.carryover_delta ?? 0) < 0
                            ? 'carryover-delta carryover-delta--minus'
                            : 'carryover-delta'
                      }
                      title={row.carryover_label && row.carryover_label !== '-' ? row.carryover_label : undefined}
                    >
                      {row.carryover_display ?? '-'}
                    </td>
                    <td className="progress-sessions-cell">
                      {Number(
                        row.progress_sessions ??
                          Math.max(0, (row.total_sessions ?? 0) + (row.carryover_delta ?? 0)),
                      )}
                    </td>
                    <td>
                      {formatCurrency(
                        row.tuition_gross_amount ??
                          row.settlement_gross_amount ??
                          row.progress_amount ??
                          0,
                      )}
                    </td>
                    <td>{row.commission_rate != null ? `${row.commission_rate}%` : '-'}</td>
                    <td>
                      <strong>
                        {formatCurrency(row.teacher_share_pre_tax ?? row.teacher_share ?? row.final_amount)}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="teacher-detail-block teacher-detail-block--flat">
        <div className="teacher-detail-block__header teacher-detail-block__header--trial">
          <h4>시범 수업</h4>
          <span>{trialRows.length}건</span>
        </div>
        {trialRows.length === 0 ? (
          <div className="empty-state compact teacher-detail-empty--centered">해당 월 시범 수업이 없습니다.</div>
        ) : (
          <div className="table-wrap">
            <table className="settlement-overview-table">
              <thead>
                <tr>
                  <th>학생</th>
                  <th>시범일</th>
                  <th>시범비</th>
                  <th>정산 수업료 (세전)</th>
                </tr>
              </thead>
              <tbody>
                {trialRows.map((row) => (
                  <tr key={row.enrollment_id}>
                    <td>{row.student_name}</td>
                    <td>{row.trial_date ?? '-'}</td>
                    <td>{formatCurrency(row.trial_fee)}</td>
                    <td>
                      <strong>{formatCurrency(row.pre_tax_amount ?? row.trial_fee)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
