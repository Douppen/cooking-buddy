import {useEffect, useState} from 'react';
import {
  App as WearablesApp,
  Page,
  Panel,
  ScrollView,
  TextStyle,
  TextView,
} from '@wearables-ui-toolkit/mrbd';
import {connectRelay, type RelayStatus} from './relay';

// Placeholder screen: proves the deployed app loads on the glasses and reaches the relay.
// Recipe steps (feature 1) replace this.
const ROOM = new URLSearchParams(location.search).get('room') ?? 'KITCHEN';

const STATUS_TEXT: Record<RelayStatus, string> = {
  connecting: 'Relay: connecting…',
  open: 'Relay: connected',
  closed: 'Relay: offline, retrying',
};

export default function App() {
  const [status, setStatus] = useState<RelayStatus>('connecting');
  const [peers, setPeers] = useState(0);

  useEffect(() => {
    const relay = connectRelay(
      ROOM,
      message => {
        if (message.t === 'peers' && typeof message.count === 'number') setPeers(message.count);
      },
      setStatus,
    );
    return () => relay.stop();
  }, []);

  return (
    <WearablesApp>
      <Page headerText="Cooking Buddy" enableSystemBarInset={false}>
        <ScrollView insetForHeader ariaLabel="Cooking Buddy status" tabIndex={0}>
          <Panel width="100%">
            <div className="content-inset">
              <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                Recipes are on their way.
              </TextView>
              <TextView as="p" textStyle={TextStyle.BODY2}>
                {status === 'open' ? `${STATUS_TEXT.open} · ${peers} in room ${ROOM}` : STATUS_TEXT[status]}
              </TextView>
            </div>
          </Panel>
        </ScrollView>
      </Page>
    </WearablesApp>
  );
}
