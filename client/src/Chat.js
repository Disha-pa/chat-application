import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const backendUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const socket = io(backendUrl);

function getRandomColor() {
  const colors = ['#25D366', '#34B7F1', '#FFEB3B', '#FF5722', '#9C27B0'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Alternative sticker URLs (Wikimedia Commons, public domain):
// 'https://upload.wikimedia.org/wikipedia/commons/4/4e/Pleiades_large.jpg',
// 'https://upload.wikimedia.org/wikipedia/commons/6/6e/Golde33443.jpg',
// 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg',

const STICKERS = [
  'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif',
  'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
  'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
  'https://media.giphy.com/media/1BcfiGlOGXzQk/giphy.gif',
  'https://media.giphy.com/media/13CoXDiaCcCoyk/giphy.gif',
  // 'https://upload.wikimedia.org/wikipedia/commons/4/4e/Pleiades_large.jpg',
  // 'https://upload.wikimedia.org/wikipedia/commons/6/6e/Golde33443.jpg',
  // 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg',
];

function Chat({ user, onLogout }) {
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: '', avatar: '' });
  const messagesEndRef = useRef(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [showStickers, setShowStickers] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [replies, setReplies] = useState({}); // messageId -> array of replies
  const [chatSearch, setChatSearch] = useState(""); // For filtering users/groups
  const [messageSearch, setMessageSearch] = useState(""); // For filtering messages
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  useEffect(() => { document.body.className = theme === 'dark' ? 'dark' : ''; localStorage.setItem('theme', theme); }, [theme]);

  // Fetch user and group list
  useEffect(() => {
    fetch(`${backendUrl}/api/users?username=${encodeURIComponent(user.username)}`)
      .then(res => res.json())
      .then(setUsers);
    fetch(`${backendUrl}/api/groups?username=${encodeURIComponent(user.username)}`)
      .then(res => res.json())
      .then(setGroups);
  }, [user.username]);

  // Join own room for private messaging
  useEffect(() => {
    socket.emit('join', user.username);
  }, [user.username]);

  // Join group room when selectedGroup changes
  useEffect(() => {
    if (selectedGroup) socket.emit('join-group', selectedGroup.name);
  }, [selectedGroup]);

  // Fetch private chat history when selectedUser changes
  useEffect(() => {
    if (selectedUser) {
      fetch(`${backendUrl}/api/messages/${user.username}/${selectedUser.username}`)
        .then(res => res.json())
        .then(setMessages);
    }
  }, [selectedUser, user.username]);

  // Fetch group chat history when selectedGroup changes
  useEffect(() => {
    if (selectedGroup) {
      fetch(`${backendUrl}/api/group-messages/${selectedGroup.name}`)
        .then(res => res.json())
        .then(setMessages);
    }
  }, [selectedGroup]);

  // Request notification permission on mount
  useEffect(() => {
    if (window.Notification && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Listen for private and group messages (with notification)
  useEffect(() => {
    const privateHandler = (msg) => {
      if (
        (msg.from === user.username && msg.to === selectedUser?.username) ||
        (msg.from === selectedUser?.username && msg.to === user.username)
      ) {
        setMessages((prev) => [...prev, msg]);
      }
      // Show notification if message is for this user, not from self, and not focused on sender
      if (
        msg.to === user.username && msg.from !== user.username &&
        (!selectedUser || selectedUser.username !== msg.from)
      ) {
        if (window.Notification && Notification.permission === 'granted') {
          new Notification(`New message from ${msg.from}`, {
            body: msg.text || '[Sticker]',
            icon: msg.avatar || undefined
          });
        }
      }
    };
    const groupHandler = (msg) => {
      if (msg.group === selectedGroup?.name) {
        setMessages((prev) => [...prev, msg]);
      }
      // Show notification if message is for a group the user is in, not from self, and not focused on group
      if (
        msg.group && msg.from !== user.username &&
        (!selectedGroup || selectedGroup.name !== msg.group)
      ) {
        if (window.Notification && Notification.permission === 'granted') {
          new Notification(`New message in #${msg.group} from ${msg.from}`, {
            body: msg.text || '[Sticker]',
            icon: msg.avatar || undefined
          });
        }
      }
    };
    socket.on('private message', privateHandler);
    socket.on('group message', groupHandler);
    return () => {
      socket.off('private message', privateHandler);
      socket.off('group message', groupHandler);
    };
  }, [selectedUser, selectedGroup, user.username]);

  // Typing indicator handlers
  useEffect(() => {
    const handleTyping = ({ from }) => {
      setTypingUsers((prev) => prev.includes(from) ? prev : [...prev, from]);
    };
    const handleStopTyping = ({ from }) => {
      setTypingUsers((prev) => prev.filter(u => u !== from));
    };
    const handleTypingGroup = ({ from, group }) => {
      if (group === selectedGroup?.name) {
        setTypingUsers((prev) => prev.includes(from) ? prev : [...prev, from]);
      }
    };
    const handleStopTypingGroup = ({ from, group }) => {
      if (group === selectedGroup?.name) {
        setTypingUsers((prev) => prev.filter(u => u !== from));
      }
    };
    socket.on('typing', handleTyping);
    socket.on('stop typing', handleStopTyping);
    socket.on('typing-group', handleTypingGroup);
    socket.on('stop typing-group', handleStopTypingGroup);
    return () => {
      socket.off('typing', handleTyping);
      socket.off('stop typing', handleStopTyping);
      socket.off('typing-group', handleTypingGroup);
      socket.off('stop typing-group', handleStopTypingGroup);
    };
  }, [selectedUser, selectedGroup]);

  // Presence: join on mount, listen for updates
  useEffect(() => {
    socket.emit('presence', user.username);
    fetch(`${backendUrl}/api/online-users`)
      .then(res => res.json())
      .then(setOnlineUsers);
    const handlePresenceUpdate = (users) => setOnlineUsers(users);
    socket.on('presence-update', handlePresenceUpdate);
    return () => socket.off('presence-update', handlePresenceUpdate);
  }, [user.username]);

  // Emit read events for private and group chats
  useEffect(() => {
    if (selectedUser && messages.length > 0) {
      socket.emit('read-message', { from: selectedUser.username, to: user.username });
    }
    if (selectedGroup && messages.length > 0) {
      socket.emit('read-group-message', { group: selectedGroup.name, username: user.username });
    }
  }, [selectedUser, selectedGroup, messages.length, user.username]);

  // Listen for read receipt updates
  useEffect(() => {
    const handleMessageRead = ({ _id, by }) => {
      setMessages((prev) => prev.map(m => m._id === _id && !m.readBy?.includes(by) ? { ...m, readBy: [...(m.readBy || []), by] } : m));
    };
    const handleGroupMessageRead = ({ _id, by }) => {
      setMessages((prev) => prev.map(m => m._id === _id && !m.readBy?.includes(by) ? { ...m, readBy: [...(m.readBy || []), by] } : m));
    };
    socket.on('message-read', handleMessageRead);
    socket.on('group-message-read', handleGroupMessageRead);
    return () => {
      socket.off('message-read', handleMessageRead);
      socket.off('group-message-read', handleGroupMessageRead);
    };
  }, []);

  // Fetch replies for a message
  const fetchReplies = async (messageId) => {
    const res = await fetch(`${backendUrl}/api/messages/${messageId}/replies`);
    const data = await res.json();
    setReplies((prev) => ({ ...prev, [messageId]: data }));
  };

  // Listen for reaction and reply events
  useEffect(() => {
    const handleReaction = ({ messageId, reactions }) => {
      setMessages((prev) => prev.map(m => m._id === messageId ? { ...m, reactions } : m));
    };
    const handleReply = (reply) => {
      setReplies((prev) => ({ ...prev, [reply.replyTo]: [...(prev[reply.replyTo] || []), reply] }));
    };
    socket.on('reaction', handleReaction);
    socket.on('reply', handleReply);
    return () => {
      socket.off('reaction', handleReaction);
      socket.off('reply', handleReply);
    };
  }, []);

  // Add reaction to a message
  const reactToMessage = (messageId, emoji) => {
    socket.emit('react', { messageId, user: user.username, emoji });
  };
  // Remove reaction
  const unreactToMessage = (messageId, emoji) => {
    socket.emit('unreact', { messageId, user: user.username, emoji });
  };

  // Reply to a message
  const sendReply = (e) => {
    e.preventDefault();
    if (replyTo && message.trim()) {
      socket.emit('reply', {
        replyTo: replyTo._id,
        from: user.username,
        to: selectedUser?.username,
        group: selectedGroup?.name,
        text: message,
        color: user.avatar ? undefined : getRandomColor(),
        avatar: user.avatar,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      setMessage('');
      setReplyTo(null);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim() && user && selectedUser) {
      socket.emit('private message', {
        from: user.username,
        to: selectedUser.username,
        text: message,
        color: user.avatar ? undefined : getRandomColor(),
        avatar: user.avatar,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      setMessage('');
    } else if (message.trim() && user && selectedGroup) {
      socket.emit('group message', {
        from: user.username,
        group: selectedGroup.name,
        text: message,
        color: user.avatar ? undefined : getRandomColor(),
        avatar: user.avatar,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      setMessage('');
    }
  };

  // Emit typing events
  const typingTimeout = useRef();
  const handleInputChange = (e) => {
    setMessage(e.target.value);
    if (selectedUser) {
      socket.emit('typing', { from: user.username, to: selectedUser.username });
      clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => {
        socket.emit('stop typing', { from: user.username, to: selectedUser.username });
      }, 1200);
    } else if (selectedGroup) {
      socket.emit('typing-group', { from: user.username, group: selectedGroup.name });
      clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => {
        socket.emit('stop typing-group', { from: user.username, group: selectedGroup.name });
      }, 1200);
    }
  };

  const addSticker = (url) => {
    console.log('Sending sticker:', url);
    if (user && (selectedUser || selectedGroup)) {
      const msg = {
        from: user.username,
        to: selectedUser?.username,
        group: selectedGroup?.name,
        text: '',
        color: user.avatar ? undefined : getRandomColor(),
        avatar: user.avatar,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sticker: url,
      };
      if (selectedUser) {
        socket.emit('private message', msg);
      } else if (selectedGroup) {
        socket.emit('group message', msg);
      }
      setShowStickers(false);
    }
  };

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!newGroup.name) return;
    const res = await fetch(`${backendUrl}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newGroup, admin: user.username })
    });
    if (res.ok) {
      setShowCreateGroup(false);
      setNewGroup({ name: '', avatar: '' });
      fetch(`${backendUrl}/api/groups?username=${encodeURIComponent(user.username)}`)
        .then(res => res.json())
        .then(setGroups);
    }
  };

  const handleJoinGroup = async (group) => {
    await fetch(`${backendUrl}/api/groups/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: group.name, username: user.username })
    });
    setSelectedGroup(group);
    setSelectedUser(null);
    fetch(`${backendUrl}/api/groups?username=${encodeURIComponent(user.username)}`)
      .then(res => res.json())
      .then(setGroups);
  };

  // Filtered users and groups
  const filteredUsers = users.filter(u => u.username.toLowerCase().includes(chatSearch.toLowerCase()));
  const filteredGroups = groups.filter(g => g.name.toLowerCase().includes(chatSearch.toLowerCase()));
  // Filtered messages
  const filteredMessages = messages.filter(msg => {
    // Check text, sender, and replies
    const textMatch = (msg.text || "").toLowerCase().includes(messageSearch.toLowerCase());
    const fromMatch = (msg.from || "").toLowerCase().includes(messageSearch.toLowerCase());
    // Check replies if available
    const replyMatch = (replies[msg._id] || []).some(r => (r.text || "").toLowerCase().includes(messageSearch.toLowerCase()));
    return textMatch || fromMatch || replyMatch;
  });

  return (
    <div className={theme} style={{ maxWidth: 1100, margin: '2rem auto', background: 'var(--bg-main)', borderRadius: 8, boxShadow: '0 2px 8px #0001', display: 'flex', height: '80vh' }}>
      {/* Sidebar: User & Group List */}
      <div style={{ width: 260, borderRight: '1px solid var(--color-border)', background: 'var(--bg-sidebar)', borderTopLeftRadius: 8, borderBottomLeftRadius: 8, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--color-border)', background: 'var(--bg-header)', color: 'var(--color-header)', fontWeight: 'bold', borderTopLeftRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center' }}>
            {user.avatar ? (
              <img src={user.avatar} alt="avatar" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '2px solid #fff', marginRight: 8 }} />
            ) : (
              <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#25D366', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 16, marginRight: 8 }}>{user.username[0].toUpperCase()}</span>
            )}
            {user.username}
          </span>
          <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} style={{ background: 'none', border: 'none', color: 'var(--color-header)', fontSize: 22, cursor: 'pointer' }} title="Toggle dark mode">{theme === 'dark' ? '🌙' : '☀️'}</button>
        </div>
        {/* Chat search input */}
        <div style={{ padding: '8px 12px', background: 'var(--bg-sidebar)' }}>
          <input
            type="text"
            value={chatSearch}
            onChange={e => setChatSearch(e.target.value)}
            placeholder="Search users/groups..."
            style={{ width: '100%', borderRadius: 16, border: '1px solid var(--color-border)', padding: '6px 12px', fontSize: 14, background: 'var(--color-input)', color: 'var(--color-text)' }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ padding: '8px 12px', fontWeight: 'bold', color: 'var(--color-link)' }}>Groups</div>
          {filteredGroups.map(g => (
            <div key={g.name} onClick={() => handleJoinGroup(g)} style={{ cursor: 'pointer', padding: 10, background: selectedGroup?.name === g.name ? '#e0f2f1' : 'transparent', display: 'flex', alignItems: 'center', gap: 10 }}>
              {g.avatar ? (
                <img src={g.avatar} alt="avatar" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#9C27B0', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 15 }}>{g.name[0].toUpperCase()}</span>
              )}
              <span>{g.name}</span>
            </div>
          ))}
          <button onClick={() => setShowCreateGroup(true)} style={{ margin: '10px 12px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 0', fontWeight: 'bold', cursor: 'pointer' }}>+ Create Group</button>
          <div style={{ padding: '8px 12px', fontWeight: 'bold', color: 'var(--color-link)', marginTop: 16 }}>Users</div>
          {filteredUsers.map(u => (
            <div key={u.username} onClick={() => { setSelectedUser(u); setSelectedGroup(null); }} style={{ cursor: 'pointer', padding: 10, background: selectedUser?.username === u.username ? '#e0f2f1' : 'transparent', display: 'flex', alignItems: 'center', gap: 10 }}>
              {u.avatar ? (
                <img src={u.avatar} alt="avatar" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#34B7F1', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 15 }}>{u.username[0].toUpperCase()}</span>
              )}
              <span>{u.username}</span>
              {onlineUsers.includes(u.username) && (
                <span style={{ width: 10, height: 10, background: '#25D366', borderRadius: '50%', display: 'inline-block', marginLeft: 6, border: '1.5px solid #fff' }} title="Online"></span>
              )}
            </div>
          ))}
        </div>
        <button onClick={onLogout} style={{ margin: 16, background: '#fff', color: 'var(--color-link)', border: '1px solid var(--color-link)', borderRadius: 4, padding: '6px 0', fontWeight: 'bold', cursor: 'pointer' }}>Logout</button>
      </div>
      {/* Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: 'var(--bg-header)', color: 'var(--color-header)', padding: '1rem', borderTopRightRadius: 8, fontWeight: 'bold', fontSize: 20, minHeight: 60, display: 'flex', alignItems: 'center' }}>
          {selectedGroup ? (
            <>
              {selectedGroup.avatar ? (
                <img src={selectedGroup.avatar} alt="avatar" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '2px solid #fff', marginRight: 8 }} />
              ) : (
                <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#9C27B0', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 16, marginRight: 8 }}>{selectedGroup.name[0].toUpperCase()}</span>
              )}
              {selectedGroup.name}
            </>
          ) : selectedUser ? (
            <>
              {selectedUser.avatar ? (
                <img src={selectedUser.avatar} alt="avatar" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '2px solid #fff', marginRight: 8 }} />
              ) : (
                <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#34B7F1', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 16, marginRight: 8 }}>{selectedUser.username[0].toUpperCase()}</span>
              )}
              {selectedUser.username}
            </>
          ) : 'Select a user or group to chat'}
        </div>
        {/* Message search input */}
        {(selectedGroup || selectedUser) && (
          <div style={{ padding: '8px 16px', background: 'var(--bg-chat)' }}>
            <input
              type="text"
              value={messageSearch}
              onChange={e => setMessageSearch(e.target.value)}
              placeholder="Search messages..."
              style={{ width: '100%', borderRadius: 16, border: '1px solid var(--color-border)', padding: '6px 12px', fontSize: 14, background: 'var(--color-input)', color: 'var(--color-text)' }}
            />
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: 'var(--bg-chat)' }}>
          {(selectedGroup || selectedUser) ? (
            <>
              {filteredMessages.map((msg, idx) => {
                console.log('Rendering message:', msg);
                return (
                  <div key={msg._id || idx} style={{ display: 'flex', flexDirection: (msg.from === user.username) ? 'row-reverse' : 'row', alignItems: 'flex-end', marginBottom: 10 }}>
                    {msg.avatar ? (
                      <img src={msg.avatar} alt="avatar" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', margin: '0 8px' }} />
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: msg.color || '#25D366', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 16, margin: '0 8px' }}>
                        {msg.from ? msg.from[0].toUpperCase() : '?'}
                      </div>
                    )}
                    <div style={{ maxWidth: '70%', background: (msg.from === user.username) ? 'var(--bg-message-own)' : 'var(--bg-message-other)', borderRadius: 8, padding: '8px 12px', boxShadow: '0 1px 2px #0001', position: 'relative', color: 'var(--color-text)' }}>
                      <div style={{ fontWeight: 'bold', fontSize: 13, color: 'var(--color-link)' }}>{msg.from || 'Unknown'}</div>
                      {/* If this is a reply, show the parent message context */}
                      {msg.replyTo && (
                        <div style={{ fontSize: 12, color: 'var(--color-typing)', borderLeft: '2px solid #25D366', paddingLeft: 8, marginBottom: 4 }}>
                          Replying to message
                        </div>
                      )}
                      {msg.sticker ? (
                        <img src={msg.sticker} alt="sticker" style={{ maxWidth: 120, maxHeight: 120, borderRadius: 8, margin: '8px 0' }}
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                      ) : (typeof msg.text === 'string' && msg.text.trim() !== '' ? (
                        <div style={{ fontSize: 15 }}>{msg.text}</div>
                      ) : null)}
                      {/* Reactions UI */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                        {['👍','😂','❤️','😮','😢','😡'].map(emoji => {
                          const count = msg.reactions?.filter(r => r.emoji === emoji).length || 0;
                          const reacted = msg.reactions?.some(r => r.emoji === emoji && r.user === user.username);
                          return (
                            <span
                              key={emoji}
                              style={{ cursor: 'pointer', fontSize: 18, background: reacted ? '#e0f2f1' : 'var(--color-input)', borderRadius: 6, padding: '2px 6px', border: reacted ? '1.5px solid #25D366' : '1.5px solid var(--color-border)' }}
                              onClick={() => reacted ? unreactToMessage(msg._id, emoji) : reactToMessage(msg._id, emoji)}
                              title={reacted ? 'Remove reaction' : 'React'}
                            >
                              {emoji} {count > 0 && count}
                            </span>
                          );
                        })}
                        {/* Reply button */}
                        <button onClick={() => { setReplyTo(msg); }} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--color-link)', cursor: 'pointer', fontSize: 14 }}>↩️ Reply</button>
                        {/* Show replies button */}
                        <button onClick={() => fetchReplies(msg._id)} style={{ marginLeft: 4, background: 'none', border: 'none', color: 'var(--color-typing)', cursor: 'pointer', fontSize: 14 }}>💬 {replies[msg._id]?.length || 0}</button>
                      </div>
                      {/* Show replies under the message */}
                      {replies[msg._id] && replies[msg._id].length > 0 && (
                        <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: '2px solid var(--color-border)' }}>
                          {replies[msg._id].map((r, i) => (
                            <div key={r._id || i} style={{ fontSize: 14, marginBottom: 2 }}>
                              <span style={{ color: 'var(--color-link)', fontWeight: 'bold' }}>{r.from}:</span> {r.text}
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--color-typing)', textAlign: 'right', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {msg.time || ''}
                        {/* Read receipt indicator */}
                        {msg.from === user.username && (selectedUser || selectedGroup) && (
                          selectedUser ? (
                            msg.readBy?.includes(selectedUser.username) ? (
                              <span title="Read" style={{ color: '#25D366', fontSize: 16, marginLeft: 4 }}>✓</span>
                            ) : (
                              <span title="Delivered" style={{ color: 'var(--color-typing)', fontSize: 16, marginLeft: 4 }}>✓</span>
                            )
                          ) : selectedGroup ? (
                            msg.readBy && selectedGroup.members && msg.readBy.length === selectedGroup.members.length ? (
                              <span title="Read by all" style={{ color: '#25D366', fontSize: 16, marginLeft: 4 }}>✓✓</span>
                            ) : (
                              <span title="Delivered to group" style={{ color: 'var(--color-typing)', fontSize: 16, marginLeft: 4 }}>✓</span>
                            )
                          ) : null
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {/* Typing indicator */}
              {typingUsers.length > 0 && (
                <div style={{ color: 'var(--color-typing)', fontStyle: 'italic', margin: '8px 0 0 8px' }}>
                  {typingUsers.length === 1
                    ? `${typingUsers[0]} is typing...`
                    : `${typingUsers.join(', ')} are typing...`}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--color-typing)', textAlign: 'center', marginTop: 40 }}>Select a user or group to start chatting</div>
          )}
          <div ref={messagesEndRef} />
        </div>
        {(selectedUser || selectedGroup) && (
          <form onSubmit={sendMessage} style={{ display: 'flex', padding: 12, background: 'var(--color-input)', borderBottomRightRadius: 8, alignItems: 'center', position: 'relative' }}>
            <button type="button" onClick={() => setShowStickers(e => !e)} style={{ background: 'none', border: 'none', fontSize: 22, marginRight: 6, cursor: 'pointer', color: 'var(--color-link)' }} title="Stickers/GIFs">🖼️</button>
            <input
              type="text"
              value={message}
              onChange={handleInputChange}
              placeholder={selectedGroup ? `Message #${selectedGroup.name}` : `Message @${selectedUser.username}`}
              style={{ flex: 1, borderRadius: 20, border: '1px solid var(--color-border)', padding: '10px 16px', marginRight: 8, background: 'var(--color-input)', color: 'var(--color-text)' }}
            />
            <button type="submit" style={{ background: '#25D366', color: '#fff', border: 'none', borderRadius: 20, padding: '0 20px', fontWeight: 'bold', fontSize: 16 }}>Send</button>
            {showStickers && (
              <div style={{ position: 'absolute', bottom: 60, left: 50, zIndex: 10, background: 'var(--bg-main)', borderRadius: 8, boxShadow: '0 2px 8px #0002', padding: 8, display: 'flex', gap: 8 }}>
                {STICKERS.map(url => (
                  <img key={url} src={url} alt="sticker" style={{ width: 48, height: 48, borderRadius: 6, cursor: 'pointer' }} onClick={() => addSticker(url)} />
                ))}
              </div>
            )}
          </form>
        )}
        {/* Reply input UI */}
        {replyTo && (
          <form onSubmit={sendReply} style={{ display: 'flex', alignItems: 'center', background: 'var(--color-input)', borderTop: '1px solid var(--color-border)', padding: 8, position: 'relative' }}>
            <span style={{ marginRight: 8, color: 'var(--color-link)', fontWeight: 'bold' }}>Replying to {replyTo.from}:</span>
            <input
              type="text"
              value={message}
              onChange={handleInputChange}
              placeholder="Type your reply..."
              style={{ flex: 1, borderRadius: 20, border: '1px solid var(--color-border)', padding: '8px 14px', marginRight: 8, background: 'var(--color-input)', color: 'var(--color-text)' }}
            />
            <button type="submit" style={{ background: '#25D366', color: '#fff', border: 'none', borderRadius: 20, padding: '0 16px', fontWeight: 'bold', fontSize: 15 }}>Send</button>
            <button type="button" onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', color: 'var(--color-typing)', fontSize: 18, marginLeft: 6, cursor: 'pointer' }}>✖</button>
          </form>
        )}
        {showCreateGroup && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: '#0008', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <form onSubmit={handleCreateGroup} style={{ background: 'var(--bg-main)', padding: 32, borderRadius: 8, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h3 style={{ margin: 0, color: 'var(--color-link)' }}>Create Group</h3>
              <input
                type="text"
                value={newGroup.name}
                onChange={e => setNewGroup(g => ({ ...g, name: e.target.value }))}
                placeholder="Group name"
                required
                style={{ padding: 10, borderRadius: 4, border: '1px solid var(--color-border)' }}
              />
              <input
                type="text"
                value={newGroup.avatar}
                onChange={e => setNewGroup(g => ({ ...g, avatar: e.target.value }))}
                placeholder="Avatar URL (optional)"
                style={{ padding: 10, borderRadius: 4, border: '1px solid var(--color-border)' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" style={{ background: '#25D366', color: '#fff', border: 'none', borderRadius: 4, padding: 10, fontWeight: 'bold', flex: 1 }}>Create</button>
                <button type="button" onClick={() => setShowCreateGroup(false)} style={{ background: 'var(--color-input)', color: 'var(--color-text)', border: 'none', borderRadius: 4, padding: 10, fontWeight: 'bold', flex: 1 }}>Cancel</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

export default Chat; 