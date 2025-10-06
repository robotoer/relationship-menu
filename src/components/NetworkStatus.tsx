import React, { useEffect, useState } from 'react';
import { getNetworkStats } from '../ipfs';
import './NetworkStatus.css';

export interface NetworkStatusProps {
  // No props needed for now
}

/**
 * Component that shows the P2P connection status and enables 
 * discovery of other peers in the network
 */
const NetworkStatus: React.FC<NetworkStatusProps> = () => {
  const [peerId, setPeerId] = useState<string | null>(null);
  const [connectedPeers, setConnectedPeers] = useState<number>(0);
  const [peerList, setPeerList] = useState<string[]>([]);
  const [multiaddrs, setMultiaddrs] = useState<string[]>([]);
  const [isNetworkReady, setIsNetworkReady] = useState<boolean>(false);
  
  useEffect(() => {
    // Update network status every 5 seconds
    const updateNetworkStatus = () => {
      const stats = getNetworkStats();
      
      if (stats.peerId) {
        setIsNetworkReady(true);
        setPeerId(stats.peerId);
        setConnectedPeers(stats.connections);
        setPeerList(stats.peers as string[]);
        setMultiaddrs(stats.multiaddrs as string[]);
      } else {
        setIsNetworkReady(false);
      }
    };
    
    // Initial update
    updateNetworkStatus();
    
    // Set up interval for updates
    const interval = setInterval(updateNetworkStatus, 5000);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="network-status">
      <h4>P2P Network</h4>
      
      <div className="status-indicator">
        <div className={`status-dot ${isNetworkReady ? 'online' : 'offline'}`}></div>
        <span>{isNetworkReady ? 'Online' : 'Offline'}</span>
      </div>
      
      {isNetworkReady && (
        <div className="network-details">
          <div className="peer-id">
            <label>Your Peer ID:</label>
            <code title={peerId || ''}>{peerId?.substring(0, 20)}...</code>
          </div>
          
          <div className="peer-count">
            <label>Connected Peers:</label>
            <span>{connectedPeers}</span>
          </div>
          
          {connectedPeers > 0 && (
            <div className="peer-list">
              <label>Peers:</label>
              <ul>
                {peerList.slice(0, 5).map((peer, idx) => (
                  <li key={idx} title={peer}>
                    {peer.substring(0, 20)}...
                  </li>
                ))}
                {peerList.length > 5 && (
                  <li className="more-peers">
                    +{peerList.length - 5} more
                  </li>
                )}
              </ul>
            </div>
          )}
          
          {multiaddrs.length > 0 && (
            <details className="multiaddrs">
              <summary>Listening Addresses ({multiaddrs.length})</summary>
              <ul>
                {multiaddrs.map((addr, idx) => (
                  <li key={idx}>
                    <code>{addr}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
};

export default NetworkStatus;
