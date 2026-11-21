import React, { useEffect, useId, useState } from 'react';
import { fetchReviewUsers } from '@/api/liveReview';
import { ActionButton } from '../../components/primary-button';
import { StatusTag } from '../../components/semantic-tags';
import './admin-team-settings.css';

const roles = { ADMIN: '관리자', STAFF: '분석가' };
const sampleMembers = [
  { id: 'preview-member-1', name: '김서윤', role: 'STAFF' },
  { id: 'preview-member-2', name: '박지호', role: 'STAFF' },
  { id: 'preview-member-3', name: '이도현', role: 'ADMIN' },
];

function MemberList({ members, onRoleChange }) {
  if (!members.length) return <p role="status">표시할 팀원이 없습니다.</p>;
  return <ul className="admin-team-list" aria-label="팀원">
    {members.map(member => <li key={member.id} className="settings-row">
      <span className="admin-team-member">
        <strong>{member.name}</strong>
        {member.self && <small>현재 계정</small>}
      </span>
      {onRoleChange && !member.self
        ? <select className="aml-native-select" aria-label={`${member.name} 권한`} value={member.role}
          onChange={event => onRoleChange(member, event.target.value)}>
          {Object.entries(roles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        : <StatusTag preset={member.role === 'ADMIN' ? 'inProgress' : 'neutral'}>{roles[member.role]}</StatusTag>}
    </li>)}
  </ul>;
}

function PreviewMembers({ sessionUser }) {
  const [members, setMembers] = useState(() => [
    { id: 'preview-viewer', name: sessionUser.name, role: 'ADMIN', self: true },
    ...sampleMembers,
  ]);
  const [notice, setNotice] = useState('');
  function changeRole(member, role) {
    if (member.self || !Object.hasOwn(roles, role) || member.role === role) return;
    setMembers(previous => previous.map(row => row.id === member.id ? { ...row, role } : row));
    setNotice(`${member.name}의 권한을 ${roles[role]}로 변경했습니다.`);
  }
  return <>
    <p>미리보기 팀원입니다. 여기서 바꾼 권한은 예제 팀에만 적용됩니다.</p>
    <MemberList members={members} onRoleChange={changeRole} />
    {notice && <p role="status">{notice}</p>}
  </>;
}

function LiveMembers({ userId }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ loading: true });
  useEffect(() => {
    let current = true;
    fetchReviewUsers().then(members => {
      if (!Array.isArray(members) || members.some(member =>
        !Number.isSafeInteger(member?.id) || member.id < 1 || typeof member.name !== 'string' || !Object.hasOwn(roles, member.role))) {
        throw new Error('팀원 응답을 확인할 수 없습니다.');
      }
      if (current) setResult({ members: members.map(member => ({ ...member, self: member.id === userId })) });
    }).catch(() => {
      if (current) setResult({ error: true });
    });
    return () => { current = false; };
  }, [attempt, userId]);
  const retry = () => {
    setResult({ loading: true });
    setAttempt(previous => previous + 1);
  };
  return <>
    <p>현재 연결에서 팀원 권한은 조회 전용입니다.</p>
    {result.loading && <p role="status">팀원 목록을 불러오는 중입니다.</p>}
    {result.error && <div className="admin-team-retry">
      <p role="alert">팀원 목록을 불러오지 못했습니다.</p>
      <ActionButton shape="pill" surface="floating" onClick={retry}>다시 불러오기</ActionButton>
    </div>}
    {result.members && <MemberList members={result.members} />}
  </>;
}

export function AdminTeamSettings({ sessionUser }) {
  const title = useId();
  if (sessionUser?.role !== 'ADMIN' || !['fixture', 'api'].includes(sessionUser.source)) return null;
  const preview = sessionUser.source === 'fixture';
  return <section aria-labelledby={title} className="admin-team-settings">
    <h3 id={title}>팀원 권한</h3>
    {preview ? <PreviewMembers key={sessionUser.id} sessionUser={sessionUser} />
      : <LiveMembers key={sessionUser.id} userId={sessionUser.id} />}
  </section>;
}
