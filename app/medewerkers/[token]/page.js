import StaffTicketForm from "../../../components/staff-ticket-form";

export default async function StaffTicketPage({ params }) {
  const { token } = await params;
  return <StaffTicketForm token={token} />;
}

