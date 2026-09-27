import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarCheckIcon,
  UsersIcon,
  CalendarDotsIcon,
  ArrowRightIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { useAuth } from "../auth";
import {
  AppointmentCard,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pager,
  ProfileCompletionCard,
  formatDate,
  useResource,
} from "../components";
import type {
  Appointment,
  Balance,
  Client,
  Dashboard,
  Earning,
  Page,
} from "../types";

export function DashboardPage() {
  const { profile } = useAuth();
  const resource = useResource<Dashboard>("/api/doctor/dashboard", true);
  const hour = Number(
    new Intl.DateTimeFormat("en", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: profile!.timezone,
    }).format(new Date()),
  );
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = profile!.firstName
    ? `${profile!.professionalStatus === "FINAL_YEAR_STUDENT" ? "" : "Dr. "}${profile!.firstName}`
    : "welcome";
  const profileUnderReview =
    profile!.verificationStatus === "PENDING" &&
    Boolean(profile!.verificationSubmittedAt);
  return (
    <>
      <PageHeader
        eyebrow="A LITTLE SPACE FOR YOUR PRACTICE"
        title={`${greeting}, ${name}.`}
        description={
          profileUnderReview
            ? "Your profile is under review. Once approved, you can enable bookings and become eligible to take sessions."
            : resource.data
            ? `You have ${resource.data.todaySessions} sessions today. Let's make room for meaningful conversations.`
            : "Your day, thoughtfully organized."
        }
      >
        <Link className="button secondary" to="/doctor/appointments">
          <CalendarDotsIcon />
          View appointments
        </Link>
      </PageHeader>
      <ErrorState message={resource.error} />
      {!profileUnderReview && !profile!.profileCompleted && <ProfileCompletionCard profile={profile!} />}
      {resource.loading ? (
        <LoadingState />
      ) : (
        resource.data && (
          <>
            <div className="stats">
              {[
                {
                  label: "Today's sessions",
                  value: resource.data.todaySessions,
                  icon: CalendarCheckIcon,
                  detail: "Your local calendar day",
                },
                {
                  label: "Total clients",
                  value: resource.data.totalClients,
                  icon: UsersIcon,
                  detail: "People in your practice",
                },
                {
                  label: "Sessions this month",
                  value: resource.data.monthSessions,
                  icon: CalendarDotsIcon,
                  detail: "Confirmed & completed sessions",
                },
                {
                  label: "Total earnings",
                  value: (resource.data.earnings ?? []).length
                    ? resource.data.earnings.map((earning) => `${earning.currency} ${earning.earned}`).join(" · ")
                    : "—",
                  icon: WalletIcon,
                  detail: "Net earnings from completed financial records",
                },
              ].map((stat) => (
                <section className="stat card" key={stat.label}>
                  <div>
                    <span>{stat.label}</span>
                    <stat.icon size={22} />
                  </div>
                  <strong>{stat.value}</strong>
                  <p>{stat.detail}</p>
                </section>
              ))}
            </div>
            <section className="card schedule-card">
              <div className="section-title">
                <div>
                  <h2>Today's schedule</h2>
                  <p>All times in {profile!.timezone}</p>
                </div>
                <Link to="/doctor/appointments">
                  All appointments <ArrowRightIcon />
                </Link>
              </div>
              {resource.data.schedule.items.length ? (
                resource.data.schedule.items.map((item) => (
                  <AppointmentCard key={item.id} appointment={item} />
                ))
              ) : (
                <EmptyState title="Your day has room to breathe">
                  No sessions are scheduled for today. Keep your availability up
                  to date so clients can find a time.
                </EmptyState>
              )}
            </section>
          </>
        )
      )}
      <div className="dashboard-bottom">
        <section className="card note-card">
          <p className="eyebrow">YOUR TIME MATTERS</p>
          <h2>Room to reset, between sessions.</h2>
          <p>
            Each appointment includes protected buffer time. Your working hours
            stay entirely in your hands.
          </p>
          <Link to="/doctor/availability">
            Manage availability <ArrowRightIcon />
          </Link>
        </section>
        <section className="card">
          <h2>Your practice status</h2>
          <dl className="status-list">
            <div>
              <dt>Professional review</dt>
              <dd className="badge">{profile!.verificationStatus}</dd>
            </div>
            <div>
              <dt>Profile</dt>
              <dd>{profile!.profileCompleted ? "Complete" : "In progress"}</dd>
            </div>
            <div>
              <dt>Accepting bookings</dt>
              <dd>{profile!.isAcceptingBookings ? "On" : "Paused"}</dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}
export function AppointmentsPage() {
  const { profile } = useAuth();
  const [filter, setFilter] = useState("upcoming"),
    [page, setPage] = useState(1);
  const resource = useResource<Page<Appointment>>(
    `/api/doctor/appointments?filter=${filter}&page=${page}`,
    true,
  );
  return (
    <>
      <PageHeader
        title="Appointments."
        description={`Track your upcoming, today, completed, and cancelled appointments. All times are shown in ${profile!.timezone}.`}
      />
      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="group" aria-label="Appointment filter">
            {["upcoming", "today", "completed", "cancelled"].map((value) => (
              <button
                key={value}
                aria-pressed={filter === value}
                className={filter === value ? "active" : ""}
                onClick={() => {
                  setFilter(value);
                  setPage(1);
                }}
              >
                {value === "cancelled" ? "Cancelled" : value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <ErrorState message={resource.error} />
        {resource.loading ? (
          <LoadingState />
        ) : (
          resource.data && (
            <>
              {resource.data.items.length ? (
                resource.data.items.map((item) => (
                  <AppointmentCard key={item.id} appointment={item} />
                ))
              ) : (
                <EmptyState title="No appointments here yet" />
              )}
              <Pager pagination={resource.data.pagination} onPage={setPage} />
            </>
          )
        )}
      </section>
    </>
  );
}
export function ClientsPage() {
  const { profile } = useAuth();
  const [page, setPage] = useState(1);
  const resource = useResource<Page<Client>>(
    `/api/doctor/clients?page=${page}`,
  );
  return (
    <>
        <PageHeader
          title="The people in your practice."
          description="Each distinct client who has booked an appointment with you appears here."
        />
      <p className="alert">
        This is a booking-based practice list, not a clinical records area. For privacy, clients are identified by practice-specific references and no name, contact, or clinical information is shown.
      </p>
      <ErrorState message={resource.error} />
      {resource.loading ? (
        <LoadingState />
      ) : (
        resource.data && (
          <section className="card">
            {resource.data.items.length ? (
              <div className="client-grid">
                {resource.data.items.map((client) => (
                  <article className="client-card" key={client.label}>
                    <span className="client-avatar">
                      <UsersIcon size={24} />
                    </span>
                    <h2>{client.label}</h2>
                    <p>{client.appointmentCount} booked appointments</p>
                    <small>
                      Latest scheduled:{" "}
                      {formatDate(
                        client.latestAppointmentAt,
                        profile!.timezone,
                      )}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="Your connections start here">
                Clients will appear after the first appointment is booked with you.
              </EmptyState>
            )}
            <Pager pagination={resource.data.pagination} onPage={setPage} />
          </section>
        )
      )}
    </>
  );
}
function VerifiedEarnings() {
  const { profile } = useAuth();
  const [page, setPage] = useState(1);
  const balances = useResource<Balance[]>("/api/doctor/earnings");
  const transactions = useResource<Page<Earning>>(
    `/api/doctor/earnings/transactions?page=${page}`,
  );
  return (
    <>
      <ErrorState message={balances.error || transactions.error} />
      {balances.loading ? (
        <LoadingState />
      ) : balances.data?.length ? (
        <div className="stats">
          {balances.data.map((balance) => (
            <section className="card stat" key={balance.currency}>
              <span>Available · {balance.currency}</span>
              <strong>{balance.available}</strong>
              <p>
                Earned {balance.earned} · Allocated to payouts{" "}
                {balance.withdrawn}
              </p>
            </section>
          ))}
        </div>
      ) : (
        <div className="card">
          <EmptyState title="Your earnings will grow here">
            Trusted financial records will appear as sessions are processed.
          </EmptyState>
        </div>
      )}
      <section className="card">
        <div className="section-title">
          <h2>Earnings ledger</h2>
          <p>Every row is a trusted session earning record, with its booking reference, amount, date, and current status.</p>
        </div>
        {transactions.loading ? (
          <LoadingState />
        ) : (
          transactions.data && (
            <>
              {transactions.data.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Recorded</th>
                        <th>Session booking</th>
                        <th>Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.data.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            {formatDate(item.createdAt, profile!.timezone)}
                          </td>
                          <td>{item.bookingId.slice(0, 8)}</td>
                          <td>
                            {item.currency} {item.amount}
                          </td>
                          <td>
                            <span className="badge">{item.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No earnings transactions yet" />
              )}
              <Pager
                pagination={transactions.data.pagination}
                onPage={setPage}
              />
            </>
          )
        )}
      </section>
      <p className="help">
        Amounts come from the earnings ledger. Automated bank payouts are not
        connected in this release.
      </p>
    </>
  );
}
export function EarningsPage() {
  const { profile } = useAuth();
  return (
    <>
      <PageHeader
        title="Your work, accounted for."
        description="A transparent view of your session earnings."
      />
      {profile!.verificationStatus === "VERIFIED" ? (
        <VerifiedEarnings />
      ) : (
        <section className="card">
          <EmptyState title="Professional approval required">
            Your earnings dashboard becomes available after professional
            verification.
          </EmptyState>
        </section>
      )}
    </>
  );
}
