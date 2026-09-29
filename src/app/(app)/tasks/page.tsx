import TasksClient from '@/components/TasksClient';
import TaskModal from '@/components/TaskModal';
import { getLeadOptions, getTasks } from '@/app/actions/task-actions';
import { getUsers } from '@/app/actions/user-actions';
import { requireUser } from '@/lib/auth';

/**
 * Global task list.
 *
 * The legacy page called `supabase.auth.getSession()` rather than
 * `getUser()`. `getSession()` reads the cookie and does not verify the JWT
 * signature against the auth server, so a forged cookie would pass the gate.
 * Auth.js verifies the session against its own database, so the check is now
 * real.
 *
 * It also fetched 1,000 leads on every visit purely to populate a prop the
 * client never read.
 */
export default async function TasksPage() {
  const user = await requireUser();

  const [tasks, users, leadOptions] = await Promise.all([
    getTasks(),
    getUsers(),
    getLeadOptions(),
  ]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <TasksClient
        initialTasks={tasks}
        user={user}
        users={users}
        leadOptions={leadOptions}
        modal={<TaskModal user={user} users={users} leadOptions={leadOptions} />}
      />
    </div>
  );
}
