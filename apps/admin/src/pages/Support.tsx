import React from 'react';
import { NotAvailable } from '../components/StateViews';

/**
 * Support is not available yet. GET /api/admin/support/tickets reads from an
 * in-memory array that nothing ever writes to (there is no SupportTicket model
 * and no way for marinas to open a ticket), so it always returns an empty list
 * and any edits are lost on restart. The old screen showed hardcoded sample
 * tickets and saved changes only in local state.
 */
const Support: React.FC = () => (
  <NotAvailable
    title="Support tickets are not available yet"
    message="The API does not store support tickets yet and marinas have no way to open one, so there is nothing to triage here. This screen will list real tickets once a ticket store exists."
  />
);

export default Support;
