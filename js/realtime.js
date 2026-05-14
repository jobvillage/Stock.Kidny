let realtimeChannels = [];

function startRealtime() {
  stopRealtime();

  if (!currentUser) return;

  // Admin/adminR: ฟังใบเบิกรอจัดของ
  if (currentUser.role === 'admin' || currentUser.role === 'stock_receiver') {
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

    const stockChannel = supabaseClient
      .channel('stock-items-admin')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'stock_items',
          filter: 'center=in.(สต็อกใหญ่,Hub Admin)',
        },
        () => {
          fetchStock();
        }
      )
      .subscribe();

    realtimeChannels.push(stockChannel);
  }

  // Staff: ถ้าต้องการ realtime เฉพาะใบเบิกของตัวเอง ค่อยเปิดภายหลัง
}

function stopRealtime() {
  realtimeChannels.forEach((channel) => {
    supabaseClient.removeChannel(channel);
  });

  realtimeChannels = [];
}