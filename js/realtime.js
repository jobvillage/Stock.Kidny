let realtimeChannels = [];

function startRealtime() {
  stopRealtime();

  if (!currentUser) return;

  const stockChannel = supabaseClient
    .channel('stock-items-all')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'stock_items',
      },
      () => {
        if (typeof fetchFreshStock === 'function') {
          fetchFreshStock();
        } else {
          fetchStock();
        }
      }
    )
    .subscribe();

  realtimeChannels.push(stockChannel);

  if (['admin', 'adminR', 'stock_receiver'].includes(currentUser.role)) {
    const requestChannel = supabaseClient
      .channel('stock-requests-pending')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'stock_requests',
          filter: 'status=eq.pending_pick',
        },
        () => {
          fetchPendingTransfers();
        }
      )
      .subscribe();

    realtimeChannels.push(requestChannel);
  }
}

function stopRealtime() {
  realtimeChannels.forEach((channel) => {
    supabaseClient.removeChannel(channel);
  });

  realtimeChannels = [];
}
