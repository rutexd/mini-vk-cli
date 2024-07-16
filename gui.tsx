import React, { useEffect, useState, useCallback } from 'react';
import { VK } from "vk-io";
import { render, Box, Text, useInput, useApp } from 'ink';
import type { IFriend } from './IFriend';
import type { IMessage } from './IMessage';
import { Page } from './Page';
import TextInput from 'ink-text-input';

if (process.versions.bun) { // fix for bun, at the state of 1.1.20 it handles bad cli frameworks
  process.stdin.resume();
}

if (!process.env.TOKEN) {
  console.error("Необходимо указать токен в переменной окружения TOKEN");
  process.exit(1);
}


const vk = new VK({ token: process.env.TOKEN ?? "" });

const REFRESH_INTERVAL = 2000; // 5 seconds
const ONLINE_STATUS_INTERVAL = 5000; // 5 seconds (changed from 30 seconds)
const width = parseInt(process.env.TWIDTH ?? "120"); // terminal width

const useAutoRefresh = <T,>(fetchFunction: () => Promise<T>, initialData: T, interval: number) => {
  const [data, setData] = useState<T>(initialData);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const newData = await fetchFunction();
        setData(newData);
      } catch (error) {
        console.error("Ошибка при обновлении данных:", error);
      }
    };

    fetchData(); // Initial fetch

    const intervalId = setInterval(fetchData, interval);

    return () => clearInterval(intervalId);
  }, [fetchFunction, interval]);

  return data;
};

const DialogPage = ({ friendId, onBack }: { friendId: number, onBack: () => void }) => {
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [friendName, setFriendName] = useState('');
  const [friendOnlineStatus, setFriendOnlineStatus] = useState('');

  const fetchFriendInfo = useCallback(async () => {
    try {
      const response = await vk.api.users.get({ user_ids: [ friendId.toString() ], fields: ['online', 'last_seen', 'first_name', 'last_name', 'online_mobile'] });
      const friend = response[0];
      setFriendName(`${friend.first_name} ${friend.last_name}`);
      let onlineStatus = '';
      if (friend.online) {
        onlineStatus = friend.online_mobile ? '(онлайн с телефона)' : '(онлайн)';
      } else if (friend.last_seen && Date.now() / 1000 - friend.last_seen.time < 5) {
        onlineStatus = '(был(а) в сети только что)';
      }
      setFriendOnlineStatus(onlineStatus);
    } catch (error) {
      console.error("Ошибка при получении информации о друге:", error);
    }
  }, [friendId]);

  const fetchMessages = useCallback(async () => {
    try {
      const response = await vk.api.messages.getHistory({ user_id: friendId, count: 20 });
      setMessages(response.items.reverse());
      setLoading(false);
    } catch (error) {
      console.error("Ошибка при получении сообщений:", error);
      setLoading(false);
    }
  }, [friendId]);

  useEffect(() => {
    fetchFriendInfo();
    fetchMessages();
    const intervalId = setInterval(fetchMessages, REFRESH_INTERVAL);
    return () => clearInterval(intervalId);
  }, [fetchFriendInfo, fetchMessages]);

  const handleSendMessage = useCallback(async () => {
    if (input.trim()) {
      try {
        await vk.api.messages.send({
          user_id: friendId,
          random_id: Math.floor(Math.random() * 1000000),
          message: input.trim()
        });
        setInput('');
        fetchMessages();
      } catch (error) {
        console.error("Ошибка при отправке сообщения:", error);
      }
    }
  }, [friendId, input, fetchMessages]);

  useInput((inputChar, key) => {
    if (key.escape) onBack();
  });

  if (loading) return <Text>Загрузка сообщений...</Text>;

  return (
    <Box flexDirection="column" width={width}>
      <Text>
        Диалог с {friendName} {friendOnlineStatus} (Нажмите ESC для возврата)
      </Text>
      <Box flexDirection="column" width={width - 2} height={15} overflowY="auto">
        {messages.map(({ id, from_id, text }) => (
          <Text key={id}>
            {from_id === friendId ? friendName : "Вы"}: {text}
          </Text>
        ))}
      </Box>
      <Box borderStyle="single" marginTop={1}>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSendMessage}
          placeholder="Введите сообщение и нажмите Enter"
        />
      </Box>
    </Box>
  );
};

const MessagesPage = ({ onBack, onSelectDialog }: { onBack: () => void, onSelectDialog: (friendId: number) => void }) => {
  const [selectedDialog, setSelectedDialog] = useState(0);

  const fetchDialogs = useCallback(async () => {
    const response = await vk.api.messages.getConversations({ count: 20, extended: 1 });
    return response;
  }, []);

  const dialogsData = useAutoRefresh(fetchDialogs, { items: [], profiles: [] }, REFRESH_INTERVAL);

  const fetchOnlineStatus = useCallback(async () => {
    const userIds = dialogsData.profiles.map(profile => profile.id);
    const response = await vk.api.users.get({ user_ids: userIds, fields: ['online', 'last_seen', 'online_mobile'] });
    return response;
  }, [dialogsData.profiles]);

  const onlineStatuses = useAutoRefresh(fetchOnlineStatus, [], ONLINE_STATUS_INTERVAL);

  useInput((_, key) => {
    if (key.escape) onBack();
    if (key.return && dialogsData.items.length > 0) onSelectDialog(dialogsData.items[selectedDialog].conversation.peer.id);
    if (key.downArrow) setSelectedDialog(prev => (prev + 1) % dialogsData.items.length);
    if (key.upArrow) setSelectedDialog(prev => (prev - 1 + dialogsData.items.length) % dialogsData.items.length);
  });

  return (
    <Box flexDirection="column" width={width}>
      <Text bold>Сообщения (ENTER для просмотра диалога, ESC для возврата):</Text>
      <Box flexDirection="column" width={width - 2}>
        {dialogsData.items.map((dialog, index) => {
          const profile = dialogsData.profiles.find(p => p.id === dialog.conversation.peer.id);
          const status = onlineStatuses.find(s => s.id === dialog.conversation.peer.id);
          let onlineStatus = '';
          if (status) {
            if (status.online) {
              onlineStatus = status.online_mobile ? '(онлайн с телефона)' : '(онлайн)';
            } else if (status.last_seen && Date.now() / 1000 - status.last_seen.time < 5) {
              onlineStatus = '(был(а) в сети только что)';
            }
          }
          const name = profile ? `${profile.first_name} ${profile.last_name}` : 'Неизвестный пользователь';
          const lastMessage = dialog.last_message ? 
            (dialog.last_message.text ? dialog.last_message.text : '(стикер)') : '';
          
          return (
            <Text key={dialog.conversation.peer.id} color={selectedDialog === index ? "green" : "white"} wrap="truncate-end">
              {`${name} ${onlineStatus}`.padEnd(Math.min(40, width - 40))} {lastMessage}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
};


const FriendsPage = ({ onBack, onSelectFriend }: { onBack: () => void, onSelectFriend: (friendId: number) => void }) => {
  const [selectedFriend, setSelectedFriend] = useState(0);

  const fetchFriends = useCallback(async () => {
    const response = await vk.api.friends.get({ fields: ["first_name", "last_name"] });
    return response.items;
  }, []);

  const friends = useAutoRefresh(fetchFriends, [], REFRESH_INTERVAL);

  const fetchOnlineStatus = useCallback(async () => {
    const userIds = friends.map(friend => friend.id);
    const response = await vk.api.users.get({ user_ids: userIds, fields: ['online'] });
    return response;
  }, [friends]);

  const onlineStatuses = useAutoRefresh(fetchOnlineStatus, [], ONLINE_STATUS_INTERVAL);

  useInput((_, key) => {
    if (key.return && friends.length > 0) onSelectFriend(friends[selectedFriend].id);
    if (key.escape) onBack();
    if (key.downArrow) setSelectedFriend(prev => (prev + 1) % friends.length);
    if (key.upArrow) setSelectedFriend(prev => (prev - 1 + friends.length) % friends.length);
  });

  return (
    <Box flexDirection="column">
      <Text>Друзья (ENTER для просмотра сообщений, ESC для возврата):</Text>
      {friends.map((friend, index) => {
        const isOnline = onlineStatuses.find(s => s.id === friend.id)?.online;
        return (
          <Text key={friend.id} color={selectedFriend === index ? "green" : "white"}>
            {friend.first_name} {friend.last_name} {isOnline ? '(онлайн)' : ''}
          </Text>
        );
      })}
    </Box>
  );
};


const App = () => {
  const [currentPage, setCurrentPage] = useState(Page.Menu);
  const [selectedFriendId, setSelectedFriendId] = useState<number | null>(null);

  const handleSelectFriend = useCallback((friendId: number) => {
    setSelectedFriendId(friendId);
    setCurrentPage(Page.Dialog);
  }, []);

  const handleBack = useCallback(() => setCurrentPage(Page.Menu), []);

  useInput((input, key) => {
    if (key.escape && currentPage !== Page.Menu) {
      setCurrentPage(Page.Menu);
      setSelectedFriendId(null);
    }
    if (currentPage === Page.Menu) {
      if (input === 'f') setCurrentPage(Page.Friends);
      if (input === 'm') setCurrentPage(Page.Messages);
      if (input === 'q' || key.escape) process.exit(0);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" padding={1}>
      {currentPage === Page.Menu && (
        <Box flexDirection="column">
          <Text>Меню (Нажмите Q или ESC для выхода):</Text>
          <Text>f - Друзья</Text>
          <Text>m - Сообщения</Text>
        </Box>
      )}
      {currentPage === Page.Friends && <FriendsPage onBack={handleBack} onSelectFriend={handleSelectFriend} />}
      {currentPage === Page.Messages && <MessagesPage onBack={handleBack} onSelectDialog={handleSelectFriend} />}
      {currentPage === Page.Dialog && selectedFriendId && (
        <DialogPage friendId={selectedFriendId} onBack={() => setCurrentPage(Page.Messages)} />
      )}
    </Box>
  );
};

render(<App />);
